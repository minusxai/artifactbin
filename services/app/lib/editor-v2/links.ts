/** Link marks: the link at the caret, setting or removing one, and the typing that makes one (a URL, `[text](url)`, a paste). */
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { Mark, ResolvedPos } from 'prosemirror-model';
import { normalizeLinkHref } from '@/lib/data/story/link-edit';
import { editorSchema } from './model';

const isLink = (mark: Mark) => mark.type === editorSchema.marks.inline && mark.attrs.tag === 'a';

function linkMark(href: string): Mark {
  return editorSchema.marks.inline.create({
    tag: 'a',
    source: {
      type: 'element', tag: 'a', isComponent: false, children: [], selfClosing: false, start: 0, end: 0,
      attributes: [{ name: 'href', value: { static: true, json: href }, start: 0, end: 0 }],
    },
  });
}

function hrefOf(mark: Mark): string | null {
  const value = mark.attrs.source?.attributes?.find((a: { name: string }) => a.name === 'href')?.value;
  return value?.static && typeof value.json === 'string' ? value.json : null;
}

/** Links are typed in prose, never in code. */
function linkable($at: ResolvedPos): boolean {
  return $at.parent.isTextblock && $at.parent.attrs.tag !== 'pre' && !$at.marks().some(mark => mark.attrs.tag === 'code');
}

/** The link the selection is in or covers; for a caret, with the whole extent the link spans in its textblock. */
export function linkAt(state: EditorState): { href: string; from: number; to: number } | null {
  const { $from, from, to, empty } = state.selection;
  let mark = (empty ? [...$from.marks(), ...($from.nodeAfter?.marks ?? [])] : []).find(isLink);
  if (!mark) state.doc.nodesBetween(from, to, node => { mark ??= node.marks.find(isLink); return !mark; });
  const href = mark && hrefOf(mark);
  if (!mark || !href) return null;
  if (!empty) return { href, from, to };
  const runs: Array<[number, number]> = [];
  $from.parent.forEach((child, offset) => {
    if (!child.marks.some(m => m.eq(mark!))) return;
    const last = runs.at(-1);
    if (last && last[1] === offset) last[1] = offset + child.nodeSize;
    else runs.push([offset, offset + child.nodeSize]);
  });
  const run = runs.find(([start, end]) => start <= $from.parentOffset && $from.parentOffset <= end);
  return run ? { href, from: $from.start() + run[0], to: $from.start() + run[1] } : null;
}

/** The link that ends exactly at `$at`: text typed there continues the sentence, not the link. */
export function linkEndingAt($at: ResolvedPos): Mark | null {
  const link = ($at.nodeBefore?.marks ?? []).find(isLink);
  return link && !$at.nodeAfter?.marks.some(m => m.eq(link)) ? link : null;
}

/** Give the link at `from..to` a new address in place: its identity and its position among the other marks stay. */
function retarget(state: EditorState, from: number, to: number, href: string): Transaction {
  const tr = state.tr;
  // One new mark per old one: the source joins adjacent runs back into one element only when they share it.
  const renamed = new Map<Mark, Mark>();
  state.doc.nodesBetween(from, to, (node, pos) => {
    const old = node.isText ? node.marks.find(isLink) : undefined;
    if (!old) return;
    const key = [...renamed.keys()].find(m => m.eq(old)) ?? old;
    if (!renamed.has(key)) {
      const source = old.attrs.source;
      const attributes = [...(source?.attributes ?? []).filter((a: { name: string }) => a.name !== 'href'), { name: 'href', value: { static: true, json: href }, start: 0, end: 0 }];
      renamed.set(key, old.type.create({ ...old.attrs, source: { ...source, attributes } }));
    }
    const next = renamed.get(key)!;
    tr.replaceWith(pos, pos + node.nodeSize, node.mark(node.marks.map(m => (m.eq(old) ? next : m))));
  });
  return tr;
}

function insertLink(state: EditorState, text: string, href: string): Transaction {
  const { from, $from } = state.selection;
  const tr = state.tr.replaceSelectionWith(editorSchema.text(text, [...$from.marks().filter(m => !isLink(m)), linkMark(href)]), false);
  return tr.setSelection(TextSelection.create(tr.doc, from + text.length)).setStoredMarks([]);
}

/**
 * Link the selection to `href`, or unlink it (`null`). A caret inside a link edits (or removes) the whole link;
 * a caret elsewhere inserts the address itself as linked text. Null when `href` is not an address a document may carry.
 */
export function setLink(state: EditorState, href: string | null): Transaction | null {
  const safe = href === null ? null : normalizeLinkHref(href);
  if (href !== null && !safe) return null;
  let { from, to } = state.selection;
  const tr = state.tr;
  if (from === to) {
    const current = linkAt(state);
    if (current && safe) return retarget(state, current.from, current.to, safe);
    if (current) ({ from, to } = current);
    else return safe ? insertLink(state, href!.trim(), safe) : tr;
  }
  state.doc.nodesBetween(from, to, node => { for (const mark of node.marks) if (isLink(mark)) tr.removeMark(from, to, mark); });
  if (safe) tr.addMark(from, to, linkMark(safe));
  return tr;
}

const plainText = (state: EditorState, from: number, to: number) => {
  let plain = true;
  state.doc.nodesBetween(from, to, node => { if (node.isInline && (!node.isText || node.marks.some(isLink))) plain = false; });
  return plain;
};

/** Typed addresses: `https://…` or `www.…`, without the punctuation that usually ends a sentence after one. */
export const TYPED_URL = /(?:^|[\s(])((?:https?:\/\/|www\.)[^\s<>()\ufffc]*[^\s<>().,;:!?'"\ufffc])$/i;
export const TYPED_MARKDOWN_LINK = /\[([^[\]\n\ufffc]+)\]\(([^()\s\ufffc]+)\)$/;

/** The address just finished at `end` (a space or Enter follows it), linked. */
export function autolink(state: EditorState, end = state.selection.from): Transaction | null {
  const $end = state.doc.resolve(end);
  if (!linkable($end)) return null;
  const match = TYPED_URL.exec($end.parent.textBetween(0, $end.parentOffset, undefined, '\ufffc'));
  // A host with a dot: `https://` alone, or a word after it, is not an address yet.
  const href = match && /^(?:https?:\/\/|www\.)[^/\s]*\w\.\w/i.test(match[1]!) && normalizeLinkHref(match[1]!);
  if (!match || !href) return null;
  const start = end - match[1]!.length;
  if (!plainText(state, start, end)) return null;
  return state.tr.addMark(start, end, linkMark(href));
}

/** `[text](url)` just closed at the caret becomes linked text. */
export function markdownLink(state: EditorState): Transaction | null {
  const { $from, empty } = state.selection;
  if (!empty || !linkable($from)) return null;
  const match = TYPED_MARKDOWN_LINK.exec($from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc'));
  const href = match && normalizeLinkHref(match[2]!);
  if (!match || !href) return null;
  const start = $from.pos - match[0].length;
  if (!plainText(state, start, $from.pos)) return null;
  const marks = (state.doc.nodeAt(start)?.marks ?? []).filter(m => !isLink(m));
  const tr = state.tr.replaceWith(start, $from.pos, editorSchema.text(match[1]!, [...marks, linkMark(href)]));
  return tr.setSelection(TextSelection.create(tr.doc, start + match[1]!.length)).setStoredMarks([]);
}

/** A pasted lone address links the selected words, or arrives as a link itself. */
export function pastedLink(state: EditorState, text: string): Transaction | null {
  const url = text.trim();
  if (!/^(?:https?:\/\/|mailto:)\S+$/i.test(url)) return null;
  const { $from, $to } = state.selection;
  if (!linkable($from) || $from.parent !== $to.parent) return null;
  const href = normalizeLinkHref(url);
  if (!href) return null;
  return state.selection.empty ? insertLink(state, url, href) : setLink(state, href);
}
