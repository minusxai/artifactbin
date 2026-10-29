/**
 * A LIVE MORPH OVER HELD EDITORS (lib/islands/morph/engine's morphDraftDom). The frame editor holds the editors whose
 * regions a redraw draws unchanged (lib/frame-edit's dom-mounter and session), and the morph must leave each held
 * editor on the page in place of its compiled blocks, under its new path, with its focus and caret, while the changed
 * regions take the draft's blocks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { mountCompiledEditRegions } from '@/lib/frame-edit/dom-mounter';
import { createFrameEditSession, type FrameEditSession } from '@/lib/frame-edit/session';
import { morphDraftDom } from '../morph/engine';

// jsdom has no layout. ProseMirror measures the caret to scroll to it when a remounted editor takes focus.
Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() });

let session: FrameEditSession | null = null;
let root: HTMLElement | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
  root?.remove();
  root = null;
  vi.restoreAllMocks();
});

/** A session over `dom`, mounted the way island-controller mounts it. */
async function open(source: string, dom: string) {
  root = document.createElement('div');
  root.innerHTML = dom;
  document.body.append(root);
  const channel = { nonce: 'test-nonce', post: () => {}, innerHtmlOf: (el: Element) => el.innerHTML };
  session = createFrameEditSession({ win: window, root, channel, requestRender: () => {}, mountCompiled: mountCompiledEditRegions });
  session.setNodes(parseJsxOrThrow(source).nodes);
  await session.mountCompiledDom();
  return { root };
}

describe('the edit mounter across a morph', () => {
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
});

describe('the edit session across a morph', () => {
  it('keeps the editor holding the caret across a redraw of the prose it shows: same editor, focus and caret', async () => {
    const frame = () => new Promise((r) => setTimeout(r, 40));
    const nodes = parseJsxOrThrow('<div><p id="x">alpha bravo</p></div>').nodes;
    const { root } = await open('<div><p id="x">alpha bravo</p></div>', '<div data-mx-ast="0"><p id="x" data-mx-ast="0.0">alpha bravo</p></div>');
    const editor = root.querySelector<HTMLElement>('.ProseMirror')!;
    editor.focus();
    const text = root.querySelector('p#x')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 3);
    range.setEnd(text, 3);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await frame();
    // The draft compiles the same prose differently (what the editor's own structural edit redraws).
    const draft = document.createElement('div');
    draft.innerHTML = '<div data-mx-ast="0"><p id="x" class="lead" data-mx-ast="0.0">alpha bravo</p></div>';
    const kept = session!.holdUnchanged(nodes, draft);
    expect(kept.size).toBe(1);
    session!.unmountCompiledDom();
    morphDraftDom(root, draft, new Set(), new Set(), kept);
    session!.setNodes(nodes);
    await session!.mountCompiledDom();
    await frame();
    expect(root.querySelector('.ProseMirror')).toBe(editor);
    expect(editor.contains(document.activeElement) || document.activeElement === editor).toBe(true);
    expect([getSelection()!.anchorNode?.textContent, getSelection()!.anchorOffset]).toEqual(['alpha bravo', 3]);
  });

});
