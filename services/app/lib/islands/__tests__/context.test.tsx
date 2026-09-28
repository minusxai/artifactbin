/* @jsxImportSource solid-js */
// DESTINATION: services/app/lib/islands/__tests__/context.test.tsx
/**
 * The island context door (lib/islands/context): kit components read the IslandContext through
 * `useIsland()`; tests and the runtime provide it with `IslandProvider`. Runs under the `islands`
 * vitest project (jsdom + vite-plugin-solid), which this track adds to vitest.config.ts.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { IslandProvider, useIsland } from '../context';
import type { IslandContext } from '../contract';

export const fakeIsland = (values: Record<string, string> = {}): IslandContext => ({
  values: () => values, value: (n) => values[n], table: () => undefined, tableSnapshot: () => undefined, pending: () => false, error: () => undefined, people: () => ({}),
  setValue: () => {}, mutate: async () => ({ dataset: 'x' }), writesUnavailable: () => null,
  viewer: () => null, drawings: () => ({}), writes: { current: () => [], subscribe: () => () => {}, dismiss: () => {} }, store: () => null,
  trustedPortal: () => null, loadChart: () => Promise.reject(new Error('no charts in this fake')),
});

function Reads() { const island = useIsland(); return <span>{String(island.value('region'))}</span>; }

describe('useIsland', () => {
  it('reads the context the provider supplies', () => {
    const host = document.createElement('div');
    const dispose = render(() => <IslandProvider value={fakeIsland({ region: 'West' })}><Reads /></IslandProvider>, host);
    expect(host.innerHTML).toBe('<span>West</span>');
    dispose();
  });
  it('throws a named error outside a provider, never a silent undefined', () => {
    expect(() => render(() => <Reads />, document.createElement('div'))).toThrow(/island context/i);
  });
});
