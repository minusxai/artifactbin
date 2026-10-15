/**
 * IN-PLACE ADOPTION (lib/islands/rt hydrateIsland, docs/phase2-architecture.md §2.3). The islands
 * test project compiles JSX non-hydratable, so this island is written the way babel-preset-solid
 * emits a HYDRATABLE island against `@mx/rt` (`getNextElement` claims the served node by its
 * hydration key, `insert` adopts the served text): the served root must come back as the SAME node,
 * updates must land in it, and disposing must leave it as static markup.
 */
import { describe, expect, it, vi } from 'vitest';
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

  it('keeps the served markup, static runs and all, when the served tree is not the one the island walks', () => {
    // The shape behind a blank page: the HTML parser moved a node out of the paragraph the island's template walks,
    // so the walk meets null and throws. A fresh render would draw every server-only static run empty (the browser
    // module has none of their content), so the served markup stays, as static markup, and the failure is reported.
    const walked = template('<div id="island"><p>a<span></span><b></b></p></div>');
    function Walker() {
      const island = useIsland();
      const el = getNextElement(walked);
      const b = (el.firstChild as Element).firstChild!.nextSibling!.nextSibling as Element;
      insert(b, () => String(island.value('region')));
      return el;
    }
    const host = document.createElement('div');
    document.body.append(host);
    // Served `<p>a<div>…</div><b>All</b></p>`: the parser closed the paragraph at the block.
    host.innerHTML = '<p id="before">static</p><div data-hk="s0-0000" id="island"><p>a<div>moved by the parser</div><b>All</b></p></div><p id="after">static</p>';
    const [before, served, after] = [...host.children];
    const rt = createIslandRuntime({ dataflow: { flow } }, (df) => createDataflowStore(df));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const dispose = hydrateIsland('s0-', Walker, rt.context, host);

    expect([...host.children]).toEqual([before, served, after]);
    expect(host.children[1]).toBe(served);
    expect(served!.textContent).toBe('amoved by the parserAll');
    expect(errors).toHaveBeenCalledWith('[islands] island failed: its markup is static', 's0-', expect.any(Error));
    expect(dispose).toBeTypeOf('function');
    dispose!();
    expect(host.children).toHaveLength(3);
    errors.mockRestore(); host.remove();
  });
});
