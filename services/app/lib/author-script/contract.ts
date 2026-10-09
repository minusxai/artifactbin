/**
 * THE AUTHOR SCRIPT'S CONTRACT: what the publish build (./author-module.server) and the page runtime that runs its
 * module (lib/islands/page-runtime) agree on. Constants only, with no imports, so the browser runtime and the island
 * build read it without reaching the build toolchain.
 *
 * lib/author-script is otherwise SERVER-ONLY: author-module.server loads @babel/core,
 * babel-preset-solid and esbuild. It has no index barrel on purpose; import the file you need, and from browser code
 * only this one.
 */

/** Where a bare npm specifier resolves (`three` → `https://esm.sh/three`): the module host every script may load from. */
export const ESM_CDN_ORIGIN = 'https://esm.sh';

/** The global the generated `page` module reads at import (lib/islands/page-runtime sets it; lib/author-script/author-module.server emits the read). */
export const PAGE_GLOBAL = '__mxPageBindings';

/**
 * WHAT AN AUTHOR SCRIPT MAY IMPORT FROM SOLID: each specifier is an entry of the island build
 * (lib/islands/vendor/*, scripts/build/build-islands.mjs), the SAME Solid the kit runs on, and exports exactly
 * these names (the build refuses a vendor chunk whose exports differ). Curated, not `export *`: esbuild splits by
 * file, so every Solid export a vendor entry keeps alive lands in the shared chunk every interactive page loads
 * (measured: `Portal` and `Dynamic` ~600 B brotli, `produce`/`unwrap` ~120 B, context, `Index`, `createUniqueId`
 * and `createRenderEffect` ~150 B, so they are left out and rt+boot and the kit closure keep their budgets). The
 * web list covers every helper Solid's JSX transform emits for `generate: 'dom'` without hydration; the publish
 * build (./author-module.server) refuses an import of any other name.
 */
export const AUTHOR_VENDOR_EXPORTS = {
  'solid-js': ['For', 'Match', 'Show', 'Switch', 'batch', 'createEffect', 'createMemo', 'createRoot', 'createSignal', 'mergeProps', 'on', 'onCleanup', 'onMount', 'splitProps', 'untrack'],
  'solid-js/web': ['addEventListener', 'classList', 'className', 'createComponent', 'delegateEvents', 'effect', 'insert', 'memo', 'mergeProps', 'render', 'setAttribute', 'setAttributeNS', 'setBoolAttribute', 'setProperty', 'setStyleProperty', 'spread', 'style', 'template', 'use'],
  'solid-js/store': ['createStore', 'reconcile'],
} as const satisfies Record<string, readonly string[]>;
