import { describe, expect, it, vi } from 'vitest';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { mountCompiledEditRegions, runSlice, sameNodes, withRegionBreaks } from '../dom-mounter';
import { replaceProseRegion } from '@/lib/editor-engine/source-edit';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { flushFlowView, repathFlowView } from '@/lib/editor-engine/flow-view';
import { storyUpdateParts } from '@/lib/document/update-parts';
import { serializeJsx } from '@/lib/jsx';
import { morphDraftDom } from '@/lib/islands/morph/engine';

describe('an idle slice of editor work', () => {
  /** Items costing `costs[i]` ms on a fake clock: which ran in this slice, and the clock at its end. */
  const slice = (costs: number[], expected = 0) => {
    let clock = 0; const ran: number[] = []; let index = 0;
    const next = runSlice(() => { const i = index; if (i >= costs.length) return undefined; index++; return () => { ran.push(i); clock += costs[i]!; }; }, () => clock, 50, expected);
    return { ran, clock, next };
  };
  it('never starts an item the last one says will not fit, so a slice ends within its budget', () => {
    // Overrunning items one per slice: 46 + 46 would be 92.
    expect(slice([46, 46, 46])).toMatchObject({ ran: [0], clock: 46, next: 46 });
    // Small items fill the slice up to the budget, no further.
    expect(slice([10, 10, 10, 10, 10, 10, 10])).toMatchObject({ ran: [0, 1, 2, 3, 4], clock: 50 });
    // The first item always runs, even when the last slice's says it is large.
    expect(slice([20, 20], 60)).toMatchObject({ ran: [0, 1], clock: 40 });
    expect(slice([])).toMatchObject({ ran: [], clock: 0 });
  });
});

describe('a region the draft draws unchanged', () => {
  it('is the same tree wherever it sits in the source, and any change of tag, attribute or text makes it another', () => {
    const at = (prefix: string, markup: string) => parseJsxOrThrow(`${prefix}<div id="r">${markup}</div>`).nodes.at(-1)!;
    const table = '<table id="t"><tbody><tr><td class="x">a <b>b</b></td></tr></tbody></table>';
    // Moved by text above it: every offset differs, the content does not.
    expect(sameNodes(at('', table), at('<p>a paragraph above</p>', table))).toBe(true);
    expect(serializeJsx([at('', table)])).toBe(serializeJsx([at('<p>a paragraph above</p>', table)]));
    for (const changed of [table.replace('a <b>', 'A <b>'), table.replace('class="x"', 'class="y"'), table.replace('<b>b</b>', '<i>b</i>'), table.replace('</tr>', '</tr><tr><td>c</td></tr>')])
      expect(sameNodes(at('', table), at('', changed)), changed).toBe(false);
  });
});

describe('compiled DOM edit mounter', () => {
  it('shows placeholders only while prose is empty and never saves them as text', () => {
    const source = '<article id="doc"><h1 id="headline" data-placeholder="Headline"></h1><p id="body" data-placeholder="Start writing…"></p></article>';
    const root = document.createElement('div');
    root.innerHTML = '<article data-mx-ast="0" id="doc"><h1 data-mx-ast="0.0" id="headline"></h1><p data-mx-ast="0.1" id="body"></p></article>';
    document.body.append(root);
    let view: EditorView | null = null;
    const onFlow = vi.fn();
    const mounted = mountCompiledEditRegions(root, parseJsxOrThrow(source).nodes, { onFlow, onView: value => { if (value) view = value; } });
    try {
      expect(root.querySelector('#headline')?.getAttribute('data-mx-placeholder')).toBe('Headline');
      expect(root.querySelector('#body')?.textContent).toBe('');
      const editor = view as unknown as EditorView;
      let headlinePosition = 1;
      editor.state.doc.descendants((node, pos) => { if (node.attrs.source?.tag === 'h1') headlinePosition = pos + 1; });
      editor.dispatch(editor.state.tr.insertText('My notes', headlinePosition));
      expect(root.querySelector('#headline')?.hasAttribute('data-mx-placeholder')).toBe(false);
      flushFlowView(editor);
      expect(onFlow).toHaveBeenCalled();
      expect(onFlow.mock.calls[0][2]).toContain('My notes');
      expect(onFlow.mock.calls[0][2]).not.toContain('data-mx-placeholder');
      expect(onFlow.mock.calls[0][2]).not.toContain('>Headline<');
    } finally { mounted.dispose(); root.remove(); }
  });

  it('mounts the regions on screen at once and the off-screen ones in later slices, never after dispose', async () => {
    // A component between each heading and table pair: six regions, one editor each.
    const blocks = Array.from({ length: 6 }, (_, i) => `<Badge id="b${i}">b</Badge><h2 id="h${i}">Table ${i}</h2><table id="t${i}"><tbody><tr><td>r${i}</td></tr></tbody></table>`).join('');
    const source = `<div id="r">${blocks}</div>`;
    const html = Array.from({ length: 6 }, (_, i) => `<span data-mx-ast="0.${i * 3}" id="b${i}">b</span><h2 data-mx-ast="0.${i * 3 + 1}" id="h${i}">Table ${i}</h2><table data-mx-ast="0.${i * 3 + 2}" id="t${i}"><tbody><tr><td>r${i}</td></tr></tbody></table>`).join('');
    const setup = () => {
      const root = document.createElement('div');
      root.innerHTML = `<div data-mx-ast="0" id="r">${html}</div>`;
      document.body.append(root);
      // Only the first heading is on screen; every other block sits below the fold.
      for (const el of root.querySelectorAll<HTMLElement>('[data-mx-ast^="0."]')) {
        const below = el.id !== 'h0';
        el.getBoundingClientRect = () => ({ top: below ? 5000 : 10, bottom: below ? 5100 : 40, left: 0, right: 100, width: 100, height: 30, x: 0, y: 0, toJSON: () => ({}) });
      }
      return root;
    };
    const root = setup();
    const mounted = mountCompiledEditRegions(root, parseJsxOrThrow(source).nodes, { onFlow: vi.fn() });
    const editors = () => root.querySelectorAll('[data-mx-edit-region]').length;
    const onScreen = editors();
    expect(onScreen).toBeGreaterThan(0);
    // Off-screen blocks still read as compiled until their slice mounts them.
    expect(root.querySelector('#t5')).not.toBeNull();
    for (let i = 0; i < 20 && root.querySelector('#r > table#t5'); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(editors()).toBeGreaterThan(onScreen);
    expect(root.querySelector('#r > table#t5')).toBeNull();
    // Each editor holds its blocks' measured height for the edit-mode CSS's off-screen placeholder.
    const height = (path: string) => root.querySelector<HTMLElement>(`[data-mx-edit-region="${path}"]`)?.style.getPropertyValue('--mx-region-h');
    expect(height('0.1')).toBe('30px');
    expect(height('0.2')).toBe('100px');
    mounted.dispose();
    expect(root.querySelectorAll('[data-mx-edit-region]').length).toBe(0);
    expect(root.querySelector('#t5')).not.toBeNull();
    root.remove();

    const again = setup();
    const early = mountCompiledEditRegions(again, parseJsxOrThrow(source).nodes, { onFlow: vi.fn() });
    const before = again.querySelectorAll('[data-mx-edit-region]').length;
    early.dispose();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(before).toBeGreaterThan(0);
    expect(again.querySelectorAll('[data-mx-edit-region]').length).toBe(0);
    expect(again.querySelectorAll('h2[data-mx-ast], table[data-mx-ast]').length).toBe(12);
    again.remove();
  });
  it('keeps the editor of a region a redraw draws unchanged, under its new path, and rebuilds only the changed one', async () => {
    const before = parseJsxOrThrow('<div id="r"><p id="a">A</p><Badge id="x">b</Badge><p id="b">B <strong>bold</strong></p></div>').nodes;
    const after = parseJsxOrThrow('<div id="r"><p id="a">A changed</p><Badge id="x">b</Badge><Badge id="y">c</Badge><p id="b">B <strong>bold</strong></p></div>').nodes;
    const root = document.createElement('div');
    root.innerHTML = '<div data-mx-ast="0" id="r"><p data-mx-ast="0.0" id="a">A</p><span data-mx-ast="0.1" id="x">b</span><p data-mx-ast="0.2" id="b">B <strong data-mx-ast="0.2.1">bold</strong></p></div>';
    document.body.append(root);
    const draft = document.implementation.createHTMLDocument('').createElement('div');
    draft.innerHTML = '<div data-mx-ast="0" id="r"><p data-mx-ast="0.0" id="a">A changed</p><span data-mx-ast="0.1" id="x">b</span><span data-mx-ast="0.2" id="y">c</span><p data-mx-ast="0.3" id="b">B <strong data-mx-ast="0.3.1">bold</strong></p></div>';
    const onFlow = vi.fn();
    const first = mountCompiledEditRegions(root, before, { onFlow });
    const kept = root.querySelector<HTMLElement>('[data-mx-edit-region="0.2"]')!;
    const changed = root.querySelector<HTMLElement>('[data-mx-edit-region="0.0"]')!;
    expect(kept).not.toBeNull();
    expect(changed).not.toBeNull();

    // Decided ahead a region a step, reading only: the draft is untouched until the hold.
    let steps = 1;
    while (!first.prepareHold(after, draft, () => false)) steps++;
    expect(steps).toBe(2);
    expect(draft.querySelector('#b')).not.toBeNull();
    const held = first.hold(after, draft);
    // Only the unchanged region is held; in the draft its blocks are a stand-in at its new path.
    expect([...held.stands.keys()]).toEqual(['0.3']);
    expect(held.stands.get('0.3')).toBe(kept);
    expect(draft.querySelector('#b')).toBeNull();
    expect(draft.querySelector('[data-mx-edit-region="0.3"]')).not.toBeNull();
    first.dispose();
    // The held editor is still on the page; the other went back to its compiled block.
    expect(kept.isConnected).toBe(true);
    expect(changed.isConnected).toBe(false);
    expect(root.querySelector('#a')?.textContent).toBe('A');

    morphDraftDom(root, draft, new Set(), new Set(), held.stands);
    expect(root.querySelector('[data-mx-edit-region]')).toBe(kept);
    const second = mountCompiledEditRegions(root, after, { onFlow }, held);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The same editor root, now answering to the region's new path; the changed region has a new editor.
    expect(root.querySelector('[data-mx-edit-region="0.3"]')).toBe(kept);
    expect(kept.querySelector('p')?.getAttribute('data-mx-ast')).toBe('0.3');
    const rebuilt = root.querySelector<HTMLElement>('[data-mx-edit-region="0.0"]')!;
    expect(rebuilt).not.toBe(changed);
    expect(rebuilt.textContent).toBe('A changed');
    expect(root.querySelector('#y')).not.toBeNull();
    second.dispose();
    // Leaving puts back the draft's compiled blocks, with the draft's paths.
    expect(root.querySelector('#b')?.getAttribute('data-mx-ast')).toBe('0.3');
    expect(root.querySelector('[data-mx-edit-region]')).toBeNull();
    root.remove();
  });
  it('keeps the editor holding the caret when the draft draws the prose it shows, and gives the draft its blocks back when the draw is called off', async () => {
    const nodes = parseJsxOrThrow('<div id="r"><p id="a">A</p><p id="b">B</p></div>').nodes;
    const root = document.createElement('div');
    root.innerHTML = '<div data-mx-ast="0" id="r"><p data-mx-ast="0.0" id="a">A</p><p data-mx-ast="0.1" id="b">B</p></div>';
    document.body.append(root);
    // The same prose, compiled differently (what an editor that typed a structural change stands in for).
    const draftOf = () => {
      const draft = document.implementation.createHTMLDocument('').createElement('div');
      draft.innerHTML = '<div data-mx-ast="0" id="r"><p data-mx-ast="0.0" id="a" class="lead">A</p><p data-mx-ast="0.1" id="b">B</p></div>';
      return draft;
    };
    let view: EditorView | null = null;
    const mount = mountCompiledEditRegions(root, nodes, { onFlow: vi.fn(), onView: (v) => { if (v) view = v; } });
    await vi.waitFor(() => expect(view).not.toBeNull());
    const editor = root.querySelector<HTMLElement>('[data-mx-edit-region="0"]')!;
    expect(editor).not.toBeNull();

    // Unfocused, an editor whose blocks compile differently is rebuilt.
    const unfocused = draftOf();
    const rebuilt = mount.hold(nodes, unfocused);
    expect(rebuilt.stands.size).toBe(0);
    rebuilt.release();

    view!.focus();
    expect(view!.hasFocus()).toBe(true);
    const draft = draftOf();
    const held = mount.hold(nodes, draft);
    expect(held.stands.get('0')).toBe(editor);
    expect(draft.querySelector('#a')).toBeNull();

    // Called off (typing landed meanwhile): the draft has its blocks again, the editor runs on with its own.
    held.release();
    expect(draft.querySelector('[data-mx-edit-region]')).toBeNull();
    expect(draft.querySelector('#a')?.className).toBe('lead');
    expect(editor.isConnected).toBe(true);
    expect(view!.isDestroyed).toBe(false);
    mount.dispose();
    // Leaving puts back the blocks it stood in for before the hold.
    expect(root.querySelector('#a')?.className).toBe('');
    root.remove();
  });
  it('never holds an editor inside a component island: the island is redrawn whole', () => {
    const nodes = parseJsxOrThrow('<Card id="c"><p id="a">A</p></Card>').nodes;
    const root = document.createElement('div');
    root.innerHTML = '<div data-hk="s0-0" data-mx-ast="0" id="c"><p data-mx-ast="0.0" id="a">A</p></div>';
    document.body.append(root);
    const draft = document.createElement('div');
    draft.innerHTML = root.innerHTML;
    const mount = mountCompiledEditRegions(root, nodes, { onFlow: vi.fn() });
    expect(root.querySelector('[data-mx-edit-region="0.0"]')).not.toBeNull();
    const held = mount.hold(nodes, draft);
    expect(held.stands.size).toBe(0);
    expect(draft.querySelector('#a')).not.toBeNull();
    held.dispose();
    mount.dispose();
    root.remove();
  });
  it('renames a compiled deck slide through the rail edit control', () => {
    const root = document.createElement('div');
    root.innerHTML = '<nav class="mx-rail"><button class="mx-rail-row"><span class="mx-rail-label"><span class="mx-rail-title">One</span></span></button><button class="mx-rail-row"><span class="mx-rail-label"><span class="mx-rail-title">Two</span></span></button></nav>';
    document.body.append(root);
    const source = '<Deck><Slide title="One"><p>One</p></Slide><Slide title="Two"><p>Two</p></Slide></Deck>';
    const onSlideTitle = vi.fn();
    const mounted = mountCompiledEditRegions(root, parseJsxOrThrow(source).nodes, { onFlow: vi.fn(), onSlideTitle });
    const control = root.querySelector<HTMLElement>('[aria-label="Edit slide 2 title"]')!;
    expect(control).not.toBeNull();
    control.click();
    const input = root.querySelector<HTMLInputElement>('[aria-label="Slide 2 title"]')!;
    input.value = 'Renamed two';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSlideTitle).toHaveBeenCalledWith('0.1', 'Renamed two');
    mounted.dispose();
    root.remove();
  });
  it('lets a region keep its flex/grid layout: the whole content adopts it, a lone block hands over its placement', () => {
    const source = '<CardContent id="c" className="flex"><p id="a">A</p><p id="b">B</p></CardContent><div id="g" className="grid"><Badge id="x">x</Badge><div id="w" className="col-span-2">Wide</div></div>';
    const root = document.createElement('div');
    root.innerHTML = '<div data-mx-ast="0" id="c" style="display:flex;flex-direction:column;gap:4px"><p data-mx-ast="0.0" id="a">A</p><p data-mx-ast="0.1" id="b">B</p></div>'
      + '<div data-mx-ast="1" id="g" style="display:grid"><span data-mx-ast="1.0" id="x">x</span><div data-mx-ast="1.1" id="w" style="grid-column-start:span 2;grid-column-end:span 2">Wide</div></div>';
    document.body.append(root);
    const mounted = mountCompiledEditRegions(root, parseJsxOrThrow(source).nodes, { onFlow: vi.fn() });
    const whole = root.querySelector<HTMLElement>('#c > [data-mx-edit-region]')!;
    expect(whole.getAttribute('data-mx-parent-layout')).toBe('flex');
    const lone = root.querySelector<HTMLElement>('#g > [data-mx-edit-region]')!;
    expect(lone.getAttribute('data-mx-parent-layout')).toBe('item');
    expect(lone.style.getPropertyValue('--mx-place-grid-column-start')).toBe('span 2');
    mounted.dispose();
    expect(root.querySelector('#c > p#a')).not.toBeNull();
    root.remove();
  });
  it('writes nothing just for entering edit mode: mounting a CLI-shaped document reports no edit', async () => {
    const source = '<div id="r"><h1 id="h">Preview QA</h1><p id="a">First paragraph.</p><p id="b">Chosen fruit: {$fruit}</p>'
      + '<Grid id="g"><GridItem x={0} w={6} h={2} id="g1"><p id="t1">Card A</p></GridItem><GridItem x={6} w={6} h={2} id="g2"><p id="t2">Card B</p></GridItem></Grid>'
      + '<ul id="l"><li id="l1">one <strong id="s">bold</strong></li></ul><p id="z">Last paragraph.</p></div>';
    const root = document.createElement('div');
    root.innerHTML = '<div data-mx-ast="0" id="r"><h1 data-mx-ast="0.0" id="h">Preview QA</h1><p data-mx-ast="0.1" id="a">First paragraph.</p>'
      + '<p data-mx-ast="0.2" id="b"><!--$-->Chosen fruit: <!--/--><!--$-->apple<!--/--></p>'
      + '<div data-mx-ast="0.3" id="g"><div data-mx-ast="0.3.0" id="g1"><p data-mx-ast="0.3.0.0" id="t1">Card A</p></div><div data-mx-ast="0.3.1" id="g2"><p data-mx-ast="0.3.1.0" id="t2">Card B</p></div></div>'
      + '<ul data-mx-ast="0.4" id="l"><li data-mx-ast="0.4.0" id="l1">one <strong data-mx-ast="0.4.0.1" id="s">bold</strong></li></ul><p data-mx-ast="0.5" id="z">Last paragraph.</p></div>';
    document.body.append(root);
    const onFlow = vi.fn(), onLayout = vi.fn(), onSlideTitle = vi.fn();
    const mounted = mountCompiledEditRegions(root, parseJsxOrThrow(source).nodes, { onFlow, onLayout, onSlideTitle });
    expect(root.querySelector('[role="textbox"][aria-label="Document text"]')).not.toBeNull();
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onFlow).not.toHaveBeenCalled();
    expect(onLayout).not.toHaveBeenCalled();
    expect(onSlideTitle).not.toHaveBeenCalled();
    mounted.dispose();
    root.remove();
  });
  it('makes stamped text hosts editable and reports only their own input', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-mx-ast="0"><button data-mx-ast="0.0">Label</button><div data-mx-ast="0.1">Other</div></div>';
    document.body.append(root);
    const onHostInput = vi.fn();
    const nodes = parseJsxOrThrow('<div><button>Label</button><div>Other</div></div>').nodes;
    const mounted = mountCompiledEditRegions(root, nodes, { onFlow: vi.fn(), onHostInput });
    const heading = root.querySelector<HTMLElement>('[data-mx-ast="0.0"]')!;
    expect(heading.contentEditable).toBe('true');
    heading.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onHostInput).toHaveBeenCalledWith('0.0');
    mounted.dispose();
    root.remove();
  });

  it('mounts a Solid prose editor by AST path while preserving an adjacent compiled island', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-mx-ast="0"><p id="one" data-mx-ast="0.0">One</p><p id="two" data-mx-ast="0.1">Two</p><div id="live" data-mx-ast="0.2">Live data</div></div>';
    document.body.append(root);
    const live = root.querySelector('#live');
    const onFlow = vi.fn();
    const nodes = parseJsxOrThrow('<div><p id="one">One</p><p id="two">Two</p><Question id="live" /></div>').nodes;
    const mounted = mountCompiledEditRegions(root, nodes, { onFlow });
    const editor = root.querySelector('[role="textbox"][aria-label="Document text"]');
    expect(editor).not.toBeNull();
    expect(editor?.querySelectorAll('p')).toHaveLength(2);
    expect(root.querySelector('#live')).toBe(live);
    expect(root.querySelector('#one')?.getAttribute('data-mx-ast')).toBe('0.0');
    mounted.dispose();
    root.remove();
  });

  it('persists a cross-paragraph replacement through the compiled region path', () => {
    const source = '<div><p id="first">alpha first paragraph</p><p id="second">bravo second paragraph</p></div>';
    const root = document.createElement('div');
    root.innerHTML = '<div data-mx-ast="0"><p id="first" data-mx-ast="0.0">alpha first paragraph</p><p id="second" data-mx-ast="0.1">bravo second paragraph</p></div>';
    document.body.append(root);
    let view: EditorView | null = null;
    let saved = source;
    const mounted = mountCompiledEditRegions(root, parseJsxOrThrow(source).nodes, {
      onView(next) { if (next) view = next; },
      onFlow(path, expected, replacement) { saved = replaceProseRegion(saved, path, expected, replacement); },
    });
    const editor = view! as EditorView;
    const paragraphs: number[] = [];
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph') paragraphs.push(pos); });
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, paragraphs[0]! + 3, paragraphs[1]! + 4)).insertText('X'));
    flushFlowView(editor);
    expect(saved).toContain('alXvo second paragraph');
    expect(saved).not.toContain('id="second"');
    mounted.dispose();
    root.remove();
  });

  it('keeps the source\'s line breaks between a region\'s blocks, so typing moves no path and needs no compile', () => {
    // Authored with a line between blocks: those breaks are child nodes, and every later path counts them.
    const source = '<div>\n<h1 id="t">Title</h1>\n<p id="a">Alpha</p>\n<p id="b">Bravo</p>\n<Question id="q" />\n<h2 id="h">After</h2>\n</div>';
    const root = document.createElement('div');
    root.innerHTML = '<div data-mx-ast="0"><h1 id="t" data-mx-ast="0.1">Title</h1><p id="a" data-mx-ast="0.3">Alpha</p><p id="b" data-mx-ast="0.5">Bravo</p><div id="q" data-mx-ast="0.7">chart</div><h2 id="h" data-mx-ast="0.9">After</h2></div>';
    document.body.append(root);
    const before = parseJsxOrThrow(source).nodes;
    let view: EditorView | null = null;
    let saved = source;
    const mounted = mountCompiledEditRegions(root, before, {
      onView(next) { if (next && !view) view = next; },
      onFlow(path, expected, replacement) { saved = replaceProseRegion(saved, path, expected, replacement); },
    });
    const editor = view! as EditorView;
    let end = 0;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph' && node.textContent === 'Bravo') end = pos + 1 + node.content.size; });
    editor.dispatch(editor.state.tr.insertText(' typed', end));
    flushFlowView(editor);
    // Only the typed words changed: the line breaks, and so every path after the region, are where they were.
    expect(saved).toBe(source.replace('Bravo', 'Bravo typed'));
    const after = parseJsxOrThrow(saved).nodes;
    expect(mounted.reconcile(before, after, after, null, { beforeSource: source, afterSource: saved })).toBe(true);
    // A second burst finds the region where the first left it.
    editor.dispatch(editor.state.tr.insertText(' again', end + ' typed'.length));
    flushFlowView(editor);
    expect(saved).toBe(source.replace('Bravo', 'Bravo typed again'));
    mounted.dispose();
    root.remove();
  });

  it('keeps typing that went on while a typed draft travelled: the late draft is not compiled and does not rewind the editor', () => {
    const source = '<div>\n<h1 id="t">Title</h1>\n<p id="b">Bravo</p>\n<Question id="q" />\n</div>';
    const root = document.createElement('div');
    root.innerHTML = '<div data-mx-ast="0"><h1 id="t" data-mx-ast="0.1">Title</h1><p id="b" data-mx-ast="0.3">Bravo</p><div id="q" data-mx-ast="0.5">chart</div></div>';
    document.body.append(root);
    // The served tree the editor mounts on spells attribute values {json, static}; the page's own parse {static, json}.
    const before = JSON.parse(JSON.stringify(parseJsxOrThrow(source).nodes, (_key, value) =>
      value && typeof value === 'object' && 'static' in value && 'json' in value ? { json: value.json, static: value.static } : value));
    let view: EditorView | null = null;
    let saved = source;
    const mounted = mountCompiledEditRegions(root, before, {
      onView(next) { if (next && !view) view = next; },
      onFlow(path, expected, replacement) { saved = replaceProseRegion(saved, path, expected, replacement); },
    });
    const editor = view! as EditorView;
    let end = 0;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph' && node.textContent === 'Bravo') end = pos + 1 + node.content.size; });
    editor.dispatch(editor.state.tr.insertText(' typed', end));
    flushFlowView(editor);
    const draft = saved;
    // Typing goes on before the draft of the first pause comes back.
    editor.dispatch(editor.state.tr.insertText(' on', end + ' typed'.length));
    // The draft's tree as the page parses it (storyUpdateParts), whose attribute values spell their keys in another order.
    const after = storyUpdateParts(draft)!.nodes;
    expect(mounted.reconcile(before, after, after, null, { beforeSource: source, afterSource: draft })).toBe(true);
    expect(editor.state.doc.textContent).toContain('Bravo typed on');
    // The next pause hands over from where the source is.
    flushFlowView(editor);
    expect(saved).toBe(source.replace('Bravo', 'Bravo typed on'));
    // A changed SHAPE is still drawn.
    const restyled = parseJsxOrThrow(saved.replace('<p id="b">', '<p id="b" className="text-xl">')).nodes;
    expect(mounted.reconcile(parseJsxOrThrow(saved).nodes, restyled, restyled, null, {})).toBe(false);
    mounted.dispose();
    root.remove();
  });

  it('lays a split block out with the region\'s usual break, and leaves a compact region compact', () => {
    const blocks = (source: string) => parseJsxOrThrow(source).nodes;
    const spaced = parseJsxOrThrow('<div>\n<p id="a">A</p>\n<p id="b">B</p>\n</div>').nodes[0] as { children: Parameters<typeof withRegionBreaks>[0] };
    expect(serializeJsx(withRegionBreaks(spaced.children.slice(1), blocks('<p id="a">A</p><p>new</p><p id="b">B</p>'))))
      .toBe('<p id="a">A</p>\n<p>new</p>\n<p id="b">B</p>\n');
    const compact = blocks('<p id="a">A</p><p id="b">B</p>');
    expect(withRegionBreaks(compact, blocks('<p id="a">A!</p><p id="b">B</p>'))).toHaveLength(2);
  });

  it('persists prose inside the acceptance document with a heading and adjacent Grids', () => {
    const source = '<div data-design="tw" className="p-10"><h1 id="title">Editor V2 acceptance</h1><p id="first" className="w-[600px] max-w-full">alpha first paragraph</p><p id="second">bravo second paragraph</p><Grid id="columns" mode="flow"><GridItem id="left" w={6}><p id="lp">Left column text</p></GridItem></Grid></div>';
    const root = document.createElement('div');
    root.innerHTML = '<div data-mx-ast="0"><h1 id="title" data-mx-ast="0.0">Editor V2 acceptance</h1><p id="first" data-mx-ast="0.1">alpha first paragraph</p><p id="second" data-mx-ast="0.2">bravo second paragraph</p><div id="columns" data-mx-ast="0.3"><div id="left" data-mx-ast="0.3.0"><p id="lp" data-mx-ast="0.3.0.0">Left column text</p></div></div></div>';
    document.body.append(root);
    let view: EditorView | null = null;
    let saved = source;
    const mounted = mountCompiledEditRegions(root, parseJsxOrThrow(source).nodes, {
      onView(next) { if (next && !view) view = next; },
      onFlow(path, expected, replacement) { saved = replaceProseRegion(saved, path, expected, replacement); },
    });
    const editor = view! as EditorView;
    const paragraphs: number[] = [];
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph') paragraphs.push(pos); });
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, paragraphs[1]! + 3, paragraphs[2]! + 4)).insertText('X'));
    flushFlowView(editor);
    expect(saved).toContain('alXvo second paragraph');
    mounted.dispose();
    root.remove();
  });

  it('adds Solid grid layout controls over compiled tiles without replacing their DOM', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-mx-ast="0"><div><div id="first" data-mx-ast="0.0">First</div><div id="second" data-mx-ast="0.1">Second</div></div></div>';
    document.body.append(root);
    const first = root.querySelector('#first');
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    const nodes = parseJsxOrThrow('<Grid cols={12}><GridItem id="first" x={0} y={0} w={6} h={2}>First</GridItem><GridItem id="second" x={6} y={0} w={6} h={2}>Second</GridItem></Grid>').nodes;
    const onLayout = vi.fn();
    const mounted = mountCompiledEditRegions(root, nodes, { onFlow: vi.fn(), onLayout });
    expect(root.querySelector('#first')).toBe(first);
    expect(root.querySelector('style[data-mx-grid-css]')).not.toBeNull();
    expect(root.querySelectorAll('[aria-label^="Move GridItem"]')).toHaveLength(2);
    // The overlay tile is `pointer-events:none`, so it can never match CSS `:hover` itself; hovering
    // the REAL compiled tile underneath must reveal that tile's grip via a mirrored class instead.
    const overlayTile = root.querySelector<HTMLElement>('[data-mx-grid-tile="first"]')!;
    expect(overlayTile.classList.contains('mx-grid-hover')).toBe(false);
    first!.dispatchEvent(new Event('pointerenter'));
    expect(overlayTile.classList.contains('mx-grid-hover')).toBe(true);
    first!.dispatchEvent(new Event('pointerleave'));
    expect(overlayTile.classList.contains('mx-grid-hover')).toBe(false);
    const grip = root.querySelector<HTMLElement>('[aria-label="Move GridItem 0.0"]')!;
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onLayout).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ path: '0.0', x: 1 })]));
    mounted.dispose();
    expect(root.querySelector('#first')).toBe(first);
    width.mockRestore();
    root.remove();
  });

  it('adopts a draft of typed prose into the LIVE editor: same view, same DOM, same caret; anything else is refused', () => {
    const source = '<div><p id="first">alpha</p><p id="second">bravo</p><Chart id="c" type="bar" /></div>';
    const tree = (text: string) => storyUpdateParts(text)!.nodes;
    const root = document.createElement('div');
    root.innerHTML = '<div data-mx-ast="0"><p id="first" data-mx-ast="0.0">alpha</p><p id="second" data-mx-ast="0.1">bravo</p><div id="c" data-mx-ast="0.2" aria-label="Question embed"><svg class="marks"></svg></div></div>';
    document.body.append(root);
    let view: EditorView | null = null;
    let saved = source;
    const mounted = mountCompiledEditRegions(root, tree(source), {
      onView(next) { if (next) view = next; },
      onFlow(path, expected, replacement) { saved = replaceProseRegion(saved, path, expected, replacement); },
    });
    const editor = view! as EditorView;
    const dom = editor.dom, chart = root.querySelector('#c')!;
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)).insertText('X'));
    flushFlowView(editor);
    expect(saved).toContain('alphaX');
    const caret = editor.state.selection.anchor;
    const draft = document.createElement('div');
    draft.innerHTML = '<div data-mx-ast="0"><p id="first" data-mx-ast="0.0">alphaX</p><p id="second" data-mx-ast="0.1">bravo</p><div id="c" data-mx-ast="0.2"></div></div>';
    // A chart whose spec changed is not prose: it must be drawn.
    const changed = saved.replace('type="bar"', 'type="line"');
    expect(mounted.reconcile(tree(source), tree(changed), tree(changed), draft)).toBe(false);
    // Typed prose only: adopted where it stands.
    expect(mounted.reconcile(tree(source), tree(saved), tree(saved), draft)).toBe(true);
    expect(view).toBe(editor);
    expect(editor.dom).toBe(dom);
    expect(editor.dom.isConnected).toBe(true);
    expect(editor.state.selection.anchor).toBe(caret);
    expect(root.querySelector('#c')).toBe(chart);
    // A draft older than what the editor shows (typed meanwhile) is never adopted over it.
    editor.dispatch(editor.state.tr.insertText('Y'));
    expect(mounted.reconcile(tree(saved), tree(saved), tree(saved), null)).toBe(false);
    expect(editor.dom.textContent).toContain('alphaXY');
    // Leaving puts the last adopted blocks back, so the page reads what was typed.
    flushFlowView(editor);
    expect(mounted.reconcile(tree(source), tree(saved), tree(saved), null)).toBe(true);
    mounted.dispose();
    expect(root.querySelector('#first')?.textContent).toBe('alphaXY');
    root.remove();
  });

  it('takes prose the source moved under it (undo, remote) in place when told the draft is the source now', () => {
    const tree = (text: string) => storyUpdateParts(text)!.nodes;
    const source = '<div><p id="first">alpha</p><table><tbody><tr><td><p id="cell">cell</p></td></tr></tbody></table><p id="last">omega</p><Chart id="c" type="bar" /></div>';
    const root = document.createElement('div');
    root.innerHTML = '<div data-mx-ast="0"><p id="first" data-mx-ast="0.0">alpha</p><table data-mx-ast="0.1"><tbody><tr><td><p id="cell">cell</p></td></tr></tbody></table><p id="last" data-mx-ast="0.2">omega</p><div id="c" data-mx-ast="0.3"></div></div>';
    document.body.append(root);
    const views: EditorView[] = [];
    const mounted = mountCompiledEditRegions(root, tree(source), { onView(next) { if (next && !views.includes(next)) views.push(next); }, onFlow() {} });
    // A table is a region of its own: typing beside it never serializes it.
    expect(views).toHaveLength(3);
    const first = views[0]!;
    const undone = source.replace('>alpha<', '>alpha restored<');
    expect(mounted.reconcile(tree(source), tree(undone), tree(undone), null, { beforeSource: source, afterSource: undone })).toBe(false);
    expect(mounted.reconcile(tree(source), tree(undone), tree(undone), null, { sync: true, beforeSource: source, afterSource: undone })).toBe(true);
    expect(views[0]).toBe(first);
    expect(first.dom.isConnected).toBe(true);
    expect(first.dom.textContent).toBe('alpha restored');
    mounted.dispose();
    root.remove();
  });
});

describe('a kept editor under a new path', () => {
  it('redraws a table\'s AST paths only when its steps run, and then on the new path everywhere', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => `<tr id="r${i}"><td>a${i}</td><td>b${i}</td></tr>`).join('');
    const nodes = parseJsxOrThrow(`<div id="d"><table id="t"><tbody>${rows}</tbody></table></div>`).nodes;
    const root = document.createElement('div');
    root.innerHTML = `<div data-mx-ast="0" id="d"><table data-mx-ast="0.0" id="t"><tbody data-mx-ast="0.0.0">${Array.from({ length: 60 }, (_, i) => `<tr data-mx-ast="0.0.0.${i}" id="r${i}"><td data-mx-ast="0.0.0.${i}.0">a${i}</td><td data-mx-ast="0.0.0.${i}.1">b${i}</td></tr>`).join('')}</tbody></table></div>`;
    document.body.append(root);
    let view: EditorView | null = null;
    const mounted = mountCompiledEditRegions(root, nodes, { onFlow: vi.fn(), onView: (v) => { if (v) view = v; } });
    await vi.waitFor(() => expect(view).not.toBeNull());
    const cells = () => [...view!.dom.querySelectorAll('td')].map((td) => td.getAttribute('data-mx-ast'));
    expect(cells()[0]).toBe('0.0.0.0.0');
    const steps = repathFlowView(view!, '0.1');
    expect(steps.length).toBeGreaterThan(0);
    // A selection change before the steps run redraws nothing: the old paths stay until the redraw.
    view!.dispatch(view!.state.tr.setSelection(TextSelection.create(view!.state.doc, 4)));
    expect(cells()[0]).toBe('0.0.0.0.0');
    // A few rows a step: the first step draws the new path at the top and leaves the rest as drawn.
    expect(steps.length).toBeGreaterThan(1);
    steps[0]!();
    expect(cells()[0]).toBe('0.1.0.0.0.0');
    expect(cells().at(-1)).toBe('0.0.0.59.1');
    for (const step of steps.slice(1)) step();
    expect(cells().every((path) => path?.startsWith('0.1.0.'))).toBe(true);
    expect(cells().at(-1)).toBe('0.1.0.0.59.1');
    expect(view!.dom.querySelector('table')?.getAttribute('data-mx-ast')).toBe('0.1.0');
    mounted.dispose();
    root.remove();
  });
});

describe('a script component mount in edit mode', () => {
  // `<Sparkline>` is no kit component: the script exports it, and the compiler emits its mount (no AST path of its
  // own) with the children as the server-rendered fallback, which is what edit mode shows while the script is stopped.
  const source = '<div id="r"><p id="intro">Intro</p><Sparkline rows={$monthly}><p id="fallback">Loading chart…</p></Sparkline></div>';
  const setup = () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-mx-ast="0" id="r"><p data-mx-ast="0.0" id="intro">Intro</p>'
      + '<div data-mx-mount="Sparkline" data-mx-props="{}" data-mx-bind=\'{"rows":"monthly"}\'><p data-mx-ast="0.1.0" id="fallback">Loading chart…</p></div></div>';
    document.body.append(root);
    return root;
  };

  it('badges the mount with what renders it and an Edit script control that names the component', () => {
    const root = setup();
    const onOpenScript = vi.fn();
    const mounted = mountCompiledEditRegions(root, parseJsxOrThrow(source).nodes, { onFlow: vi.fn(), onOpenScript });
    const badge = root.querySelector<HTMLElement>('[role="group"][aria-label="Sparkline · rendered by the script"]');
    expect(badge).not.toBeNull();
    expect(badge!.closest('[data-mx-mount]')?.getAttribute('data-mx-mount')).toBe('Sparkline');
    expect(badge!.textContent).toContain('Sparkline · rendered by the script');
    const button = [...badge!.querySelectorAll('button')].find((b) => b.textContent === 'Edit script');
    expect(button).toBeDefined();
    button!.click();
    expect(onOpenScript).toHaveBeenCalledWith('Sparkline');
    mounted.dispose();
    root.remove();
  });

  it('keeps the fallback out of inline editing: no prose editor, no editable host, inert while edit mode lasts', () => {
    const root = setup();
    const mounted = mountCompiledEditRegions(root, parseJsxOrThrow(source).nodes, { onFlow: vi.fn() });
    const fallback = root.querySelector<HTMLElement>('#fallback')!;
    // The intro paragraph outside the mount is a prose region like any other; the fallback is not.
    expect(root.querySelector('[data-mx-edit-region="0.0"]')).not.toBeNull();
    expect(fallback.closest('[data-mx-edit-region], .ProseMirror')).toBeNull();
    expect(fallback.isContentEditable || fallback.getAttribute('contenteditable') === 'true').toBe(false);
    expect(fallback.hasAttribute('inert')).toBe(true);
    // Editor chrome, which selection and arrow navigation skip.
    expect(root.querySelector('[role="group"][aria-label$="rendered by the script"]')!.hasAttribute('data-mx-node-chrome')).toBe(true);
    mounted.dispose();
    root.remove();
  });

  it('leaves the mount exactly as served when edit mode ends, so the script mounts over its own fallback again', () => {
    const root = setup();
    const mount = root.querySelector('[data-mx-mount]')!;
    const served = mount.innerHTML;
    const mounted = mountCompiledEditRegions(root, parseJsxOrThrow(source).nodes, { onFlow: vi.fn() });
    expect(mount.innerHTML).not.toBe(served);
    mounted.dispose();
    expect(mount.innerHTML).toBe(served);
    root.remove();
  });
});
