/**
 * `next/dynamic`, for the runtime bundle — which is NOT a Next app.
 *
 * The served document's bundle is built by esbuild and runs inside a sandboxed
 * iframe with no Next runtime, so the real `next/dynamic` never resolves: its
 * loadable state machine leaves the component parked on its `loading` fallback
 * forever (observed: every chart stuck on "loading chart…" once the module
 * became a real network fetch instead of an inlined one).
 *
 * React.lazy + Suspense is the same contract in plain React, so the build
 * aliases `next/dynamic` here (scripts/build-story-runtime.mjs). The app's own
 * chunks keep the real one.
 *
 * Two details are load-bearing:
 *  - the loader may resolve to the COMPONENT itself (`import(x).then(m =>
 *    m.VegaChart)`), not a module with a `default` — hence `default ?? module`;
 *  - `ssr: false` must render the fallback during server rendering AND on the
 *    client's first pass, or the two would disagree and hydration would fail.
 */
import { createElement, lazy, Suspense, useEffect, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';

interface DynamicOptions {
  ssr?: boolean;
  loading?: ComponentType<Record<string, never>>;
}

type Loader = () => Promise<ComponentType<unknown> | { default: ComponentType<unknown> }>;

export default function dynamic(loader: Loader, options: DynamicOptions = {}): ComponentType<Record<string, unknown>> {
  const Lazy = lazy(async () => {
    const loaded = await loader();
    const component = (loaded as { default?: ComponentType<unknown> }).default ?? (loaded as ComponentType<unknown>);
    return { default: component as ComponentType<Record<string, unknown>> };
  });

  const fallback = (): ReactNode => (options.loading ? createElement(options.loading, {} as Record<string, never>) : null);

  return function DynamicShim(props: Record<string, unknown>) {
    // `ssr: false` means the server rendered the FALLBACK, so the client's
    // first pass must render the fallback too — hydration compares that pass,
    // not what comes after it. Mounting the real component from an effect is
    // what makes the two agree (a `typeof window` branch does not: on the
    // client that branch is already true during hydration).
    const [mounted, setMounted] = useState(options.ssr !== false);
    useEffect(() => setMounted(true), []);
    if (!mounted) return fallback();
    return createElement(Suspense, { fallback: fallback() }, createElement(Lazy, props));
  };
}
