/**
 * THE ISLAND CONTEXT DOOR. Every kit component reads the document's `IslandContext` (lib/islands/contract)
 * through `useIsland()`; the runtime (rt.ts) and tests supply it with `IslandProvider`. One context per
 * document, shared by every island in it.
 *
 * Plain `.ts` (no JSX): Solid 2.0 context objects are components themselves, so the provider is a
 * `createComponent` call and this module needs no JSX transform.
 */
import { createComponent, createContext, useContext } from 'solid-js';
import type { Element as SolidElement } from 'solid-js';
import type { IslandContext } from './contract';

/** `null` default, never `undefined`: Solid 2.0's `useContext` throws its own anonymous error for a context with no default. */
const Island = createContext<IslandContext | null>(null);

export function IslandProvider(props: { value: IslandContext; children?: SolidElement }): SolidElement {
  return createComponent(Island, {
    get value() { return props.value; },
    get children() { return props.children; },
  });
}

/** The island's context. Throws when no `IslandProvider` is above the caller — a silent `undefined` would surface later as a confusing read on nothing. */
export function useIsland(): IslandContext {
  const island = useContext(Island);
  if (!island) throw new Error('island context: no IslandProvider above this island');
  return island;
}
