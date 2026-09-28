/**
 * The page's Solid specifiers → Solid 2.0. Compiled pages, islands and their tests import Solid as
 * `solid-js`, `solid-js/web` and `solid-js/store` (the Phase 2 contract's names); Solid 2.0 publishes
 * the renderer as `@solidjs/web` and folds the store into `solid-js` (surface: lib/islands/solid-store.ts).
 * One map, read by scripts/build-islands.mjs (the browser chunks) and vitest.config.ts (the islands
 * project); lib/islands/solid-compat.d.ts states the same for TypeScript.
 */
import path from 'node:path';

const ISLANDS_SRC = path.resolve(import.meta.dirname, '../../services/app/lib/islands');

export const SOLID_ALIASES = Object.freeze({
  'solid-js/web': '@solidjs/web',
  'solid-js/store': path.join(ISLANDS_SRC, 'solid-store.ts'),
});
