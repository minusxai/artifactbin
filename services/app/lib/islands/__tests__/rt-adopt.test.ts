/**
 * IN-PLACE ADOPTION (lib/islands/rt hydrateIsland, docs/phase2-architecture.md §2.3). The islands
 * test project compiles JSX non-hydratable, so this island is written the way babel-preset-solid
 * emits a HYDRATABLE island against `@mx/rt` (`getNextElement` claims the served node by its
 * hydration key, `insert` adopts the served text): the served root must come back as the SAME node,
 * updates must land in it, and disposing must leave it as static markup.
 */
import { describe, expect, it } from 'vitest';
import { createIslandRuntime, getNextElement, hydrateIsland, insert, template } from '../rt';
import { useIsland } from '../context';
import { createDataflowStore } from '@/lib/page-store/store';
import type { CompiledDataflow } from '@/lib/dataflow';

const flow: CompiledDataflow = { imports: [], mutations: [], queries: [], values: [{ name: 'region', kind: 'scalar', type: 'string', default: 'All' }] };

const tmpl = template('<div id="island"><b></b></div>');
function Island() {
  const island = useIsland();
  const el = getNextElement(tmpl);
  insert(el.firstChild as Element, () => String(island.value('region')));
  return el;
}

describe('hydrateIsland (hydratable island code)', () => {
  it('adopts the served root node itself, follows the store, and leaves static DOM on dispose', () => {
    const host = document.createElement('div');
    document.body.append(host);
    // The key Solid 1.9 gives the root under `withIsland`: three component levels (IslandProvider,
    // the context's Provider, the island) each extend the render id by one digit, then the element.
    // The SSR render goes through the same `withIsland`, so the server writes this same key.
    host.innerHTML = '<p id="before">static</p><div data-hk="s0-0000" id="island"><b>All</b></div><p id="after">static</p>';
    const [before, served, after] = [...host.children];
    const rt = createIslandRuntime({ dataflow: { flow } }, (df) => createDataflowStore(df));

    const dispose = hydrateIsland('s0-', Island, rt.context, host);

    expect(dispose).toBeTypeOf('function');
    expect([...host.children]).toEqual([before, served, after]);
    expect(host.children[1]).toBe(served);
    rt.context.setValue('region', 'West');
    expect(served!.textContent).toBe('West');

    dispose!();
    rt.context.setValue('region', 'East');
    expect(served!.textContent, 'a disposed island is static markup').toBe('West');
    expect(host.children).toHaveLength(3);
    host.remove();
  });

  it('answers null for a page without the island and never builds a selector from an odd key', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div data-hk="s0-0">x</div>';
    const rt = createIslandRuntime({}, (df) => createDataflowStore(df));
    expect(hydrateIsland('s9-', Island, rt.context, host)).toBeNull();
    expect(hydrateIsland('s0-"]', Island, rt.context, host)).toBeNull();
    expect(rt.store).toBeNull();
  });
});
