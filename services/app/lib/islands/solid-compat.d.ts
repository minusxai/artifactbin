/**
 * THE PAGE'S SOLID SPECIFIERS, TYPED. Compiled pages, islands and their tests import Solid under the
 * specifiers the Phase 2 contract names (`solid-js/web`, `solid-js/store`, and the JSX pragma
 * `@jsxImportSource solid-js`). Solid 2.0 moved the renderer to `@solidjs/web` and the store into
 * `solid-js` itself, so those subpaths no longer exist in the package; the toolchain maps them —
 * scripts/build-islands.mjs for the browser chunks, the `islands` vitest project for tests — and this
 * file tells TypeScript the same thing. The store surface is lib/islands/solid-store.ts.
 */
declare module 'solid-js/web' {
  export * from '@solidjs/web';
}

declare module 'solid-js/store' {
  export * from '@/lib/islands/solid-store';
}

declare module 'solid-js/jsx-runtime' {
  export * from '@solidjs/web/jsx-runtime';
}
