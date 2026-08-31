/**
 * `next/dynamic`'s shape, with its `ssr: false` semantics kept: the component
 * mounts only in the browser, after the first commit. A React.lazy alone is
 * not that — SSR would suspend on a boundary the server can never resolve, and
 * React answers that by discarding the tree and re-rendering the root (#419;
 * seen as "no page errors" failing in the full-kit gate, with the chart
 * drawing anyway because the recovery worked). Everything reached through this
 * shim is a client-only pane: the editor, Monaco, the chart chunk.
 */
'use client';
import { createElement, lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';

export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
  opts: { loading?: () => ReactNode; ssr?: boolean } = {},
): ComponentType<P> {
  const Lazy = lazy(async () => {
    const m = await loader();
    return 'default' in m ? m : { default: m as ComponentType<P> };
  });
  const fallback = () => (opts.loading ? opts.loading() : null);
  const Dynamic = (props: P) => {
    // The server renders the fallback; the client swaps in the real component
    // after mount, so the two agree on the first paint and nothing suspends
    // where it cannot resolve.
    const [mounted, setMounted] = useState(opts.ssr === true);
    useEffect(() => { setMounted(true); }, []);
    if (!mounted) return fallback();
    return createElement(Suspense, { fallback: fallback() }, createElement(Lazy, props));
  };
  Dynamic.displayName = 'Dynamic';
  return Dynamic;
}
