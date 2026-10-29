/**
 * The editor engine's pure leaves: links (the link at the caret, setting and removing one, autolinks and pasted
 * addresses), bookmarks over source identities, selection-wide mark state, which trees are prose, annotation
 * operation folding and the inert selection presentation. ProseMirror state only, no view.
 */
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { serializeJsx, parseJsx, type JsxNode } from '@/lib/jsx';
import { editorDocument, inlineStates, isProseTree, sourceNodes } from '../model';
import { autolink, linkAt, linkEndingAt, pastedLink, setLink, TYPED_URL } from '../links';
import { captureBookmark, resolveBookmark } from '../bookmark';
import { combineAnnotationOperations } from '../annotation-map';
import { SELECTION_PRESENTATION } from '../selection-presentation';

const nodesOf = (source: string): JsxNode[] => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.nodes;
};
const state = (source: string, from = 1, to = from) => {
  const s = EditorState.create({ doc: editorDocument(nodesOf(source)) });
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)));
};
const sourceOf = (s: EditorState) => serializeJsx(sourceNodes(s.doc));

// "see " is 1–5, "here" 5–9, " now" 9–13.
const LINKED = '<p id="p1">see <a href="https://a.test">here</a> now</p>';

describe('links', () => {
  it('linkAt answers a caret inside a link with its whole extent, and a covered selection with the selection', () => {
    expect(linkAt(state(LINKED, 7))).toEqual({ href: 'https://a.test', from: 5, to: 9 });
    expect(linkAt(state(LINKED, 3, 7))).toEqual({ href: 'https://a.test', from: 3, to: 7 });
    expect(linkAt(state(LINKED, 2))).toBeNull();
    expect(linkAt(state('<p>plain</p>', 2))).toBeNull();
  });

  it('linkEndingAt: text typed right after a link continues the sentence', () => {
    const s = state(LINKED);
    expect(linkEndingAt(s.doc.resolve(9))?.attrs.tag).toBe('a');
    expect(linkEndingAt(s.doc.resolve(7))).toBeNull();
    expect(linkEndingAt(s.doc.resolve(5))).toBeNull();
  });

  it('setLink retargets the link at the caret, links a selection, and unlinks with null', () => {
    const s = state(LINKED, 7);
    expect(sourceOf(s.apply(setLink(s, 'https://b.test')!))).toBe('<p id="p1">see <a href="https://b.test">here</a> now</p>');
    expect(sourceOf(s.apply(setLink(s, null)!))).toBe('<p id="p1">see here now</p>');
    const words = state('<p id="p1">see here now</p>', 5, 9);
    expect(sourceOf(words.apply(setLink(words, 'https://c.test')!))).toBe(LINKED.replace('a.test', 'c.test'));
  });

  it('setLink inserts the address as linked text at a bare caret, and refuses an unsafe address', () => {
    const s = state('<p id="p1">go </p>', 4);
    expect(sourceOf(s.apply(setLink(s, ' https://d.test ')!))).toBe('<p id="p1">go <a href="https://d.test">https://d.test</a></p>');
    expect(setLink(s, 'javascript:alert(1)')).toBeNull();
    expect(setLink(state(LINKED, 7), 'javascript:alert(1)')).toBeNull();
  });

  it('TYPED_URL matches an address just finished, without trailing sentence punctuation', () => {
    expect(TYPED_URL.exec('see https://a.test/x')?.[1]).toBe('https://a.test/x');
    expect(TYPED_URL.exec('see https://a.test/x.')).toBeNull();
    expect(TYPED_URL.exec('(www.example.com)')).toBeNull();
    expect(TYPED_URL.exec('(www.example.com')?.[1]).toBe('www.example.com');
    expect(TYPED_URL.exec('nohttps://a.test')).toBeNull();
    expect(TYPED_URL.exec('')).toBeNull();
  });

  it('autolink links an address once a host with a dot is typed, and nothing else', () => {
    const s = state('<p id="p1">see https://a.test</p>', 19);
    const linked = s.apply(autolink(s)!);
    expect(sourceOf(linked)).toBe('<p id="p1">see <a href="https://a.test">https://a.test</a></p>');
    expect(autolink(linked)).toBeNull();
    expect(autolink(state('<p id="p1">see https://</p>', 13))).toBeNull();
    expect(autolink(state('<p id="p1">plain words</p>', 12))).toBeNull();
    expect(autolink(state('<pre id="c">https://a.test</pre>', 15))).toBeNull();
  });

  it('pastedLink links the selected words or arrives as a link; anything else is plain paste', () => {
    const words = state('<p id="p1">see here</p>', 5, 9);
    expect(sourceOf(words.apply(pastedLink(words, ' https://a.test\n')!))).toBe('<p id="p1">see <a href="https://a.test">here</a></p>');
    const caret = state('<p id="p1">x</p>', 2);
    expect(sourceOf(caret.apply(pastedLink(caret, 'mailto:a@b.test')!))).toContain('<a href="mailto:a@b.test">mailto:a@b.test</a>');
    expect(pastedLink(caret, 'two words')).toBeNull();
    expect(pastedLink(caret, 'https://a.test and more')).toBeNull();
    expect(pastedLink(caret, 'javascript:alert(1)')).toBeNull();
  });
});

describe('bookmarks', () => {
  const source = '<div id="d"><p id="p1">alpha</p><p id="p2">beta</p></div>';

  it('captures both ends as source id and offset, and resolves them back after a redraw', () => {
    const doc = editorDocument(nodesOf(source));
    const start = (id: string) => resolveBookmark(doc, { anchor: { id, offset: 0 }, head: { id, offset: 0 } })!.anchor;
    const s = state(source, start('p1') + 2, start('p2') + 3);
    const bookmark = captureBookmark(s)!;
    expect(bookmark).toEqual({ anchor: { id: 'p1', offset: 2 }, head: { id: 'p2', offset: 3 } });
    const selection = resolveBookmark(EditorState.create({ doc: editorDocument(nodesOf(source)) }).doc, bookmark)!;
    expect([selection.anchor, selection.head]).toEqual([s.selection.anchor, s.selection.head]);
  });

  it('clamps an offset past the end, and is undefined when an id is gone or absent', () => {
    const doc = editorDocument(nodesOf(source));
    const clamped = resolveBookmark(doc, { anchor: { id: 'p1', offset: 99 }, head: { id: 'p1', offset: -4 } })!;
    expect(clamped.anchor - clamped.head).toBe('alpha'.length);
    expect(doc.textBetween(clamped.head, clamped.anchor)).toBe('alpha');
    expect(resolveBookmark(doc, { anchor: { id: 'gone', offset: 0 }, head: { id: 'p1', offset: 0 } })).toBeUndefined();
    expect(captureBookmark(state('<p>no id</p>', 2))).toBeUndefined();
  });
});

describe('selection-wide marks', () => {
  it('answers true, false or mixed per tag, aliases included', () => {
    expect(inlineStates(state('<p><b>bold</b> <em>it</em></p>', 1, 9))).toEqual({ strong: 'mixed', em: 'mixed', u: false });
    expect(inlineStates(state('<p><strong>all</strong></p>', 1, 4))).toEqual({ strong: true, em: false, u: false });
    expect(inlineStates(state('<p><i><u>x</u></i></p>', 2))).toMatchObject({ em: true, u: true });
    expect(inlineStates(state('<p>plain</p>', 2))).toEqual({ strong: false, em: false, u: false });
  });
});

describe('isProseTree', () => {
  it('text and plain prose elements are prose; components, controls and dynamic content are not', () => {
    const [p, card] = nodesOf('<p>Hi <b>there</b></p><Card>x</Card>');
    expect(isProseTree(p!)).toBe(true);
    expect(isProseTree(p!)).toBe(true);
    expect(isProseTree(card!)).toBe(false);
    expect(isProseTree({ type: 'text', value: 'x', start: 0, end: 1 })).toBe(true);
    expect(isProseTree(nodesOf('{$show && (<p>x</p>)}')[0]!)).toBe(false);
  });
});

describe('combineAnnotationOperations', () => {
  const map = { id: 'a', kind: 'map' as const, maps: [] };
  it('cancels a gesture undone before it reached the wire, and keeps unrelated ones', () => {
    expect(combineAnnotationOperations([map], [{ id: 'a', kind: 'undo' }])).toEqual([]);
    expect(combineAnnotationOperations([{ id: 'a', kind: 'undo' }], [{ id: 'a', kind: 'redo' }])).toEqual([]);
    expect(combineAnnotationOperations([map], [{ id: 'b', kind: 'undo' }])).toEqual([map, { id: 'b', kind: 'undo' }]);
    expect(combineAnnotationOperations([map], [map])).toEqual([map]);
    expect(combineAnnotationOperations()).toEqual([]);
  });
});

describe('selection presentation', () => {
  it('comment selection is amber; edit selection is a thin neutral important outline that never reshapes', () => {
    expect(SELECTION_PRESENTATION.selectedCss).toContain('rgba(245, 158, 11, 0.85)');
    expect(SELECTION_PRESENTATION.editSelectedCss).toMatch(/^outline: 1px solid rgba\(100, 116, 139, 0\.55\) !important;/);
    expect(SELECTION_PRESENTATION.editSelectedCss).not.toContain('border-radius');
    expect(SELECTION_PRESENTATION.editSelectedCss.split(';').filter((rule) => rule.trim()).every((rule) => rule.includes('!important'))).toBe(true);
  });
});
