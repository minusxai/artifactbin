/**
 * `solid-js/store` for Solid 2.0: the store primitives now live in `solid-js` itself. The island build
 * (scripts/build-islands.mjs) and the `islands` vitest project resolve the contract's `solid-js/store`
 * specifier to this module (see solid-compat.d.ts).
 */
export { $PROXY, $TRACK, createOptimisticStore, createProjection, createStore, deep, isWrappable, merge, omit, reconcile, snapshot } from 'solid-js';
export type { NotWrappable, Store, StoreNode, StoreOptions, StoreSetter } from 'solid-js';
