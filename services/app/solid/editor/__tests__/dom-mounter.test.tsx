import { describe, expect, it, vi } from 'vitest';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { mountCompiledEditRegions, withRegionBreaks } from '../dom-mounter';
import { replaceProseRegion } from '@/lib/editor-v2/source-edit';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { flushFlowView } from '@/lib/editor-v2/flow-view';
import { storyUpdateParts } from '@/lib/story/document/update-parts';
import { serializeJsx } from '@/lib/jsx';

describe('compiled DOM edit mounter', () => {
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
