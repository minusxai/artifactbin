import { describe, expect, it, vi } from 'vitest';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { mountCompiledEditRegions } from '../dom-mounter';
import { replaceProseRegion } from '@/lib/editor-v2/source-edit';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

describe('compiled DOM edit mounter', () => {
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
    expect(saved).toContain('alXvo second paragraph');
    expect(saved).not.toContain('id="second"');
    mounted.dispose();
    root.remove();
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
});
