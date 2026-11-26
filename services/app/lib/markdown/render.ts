/**
 * THE ONE HTML WRITER: the module's document → the shared markup, which the editor entry's extensions emit too
 * (their on-screen DOM equals this, apart from the attributes and nodes editor-contract.ts lists).
 *
 * The markup, from today's af-markdown (./content.ts):
 * - p; h1-h6, h1-h3 with `data-mx-markdown-heading="<n>"` numbered in document order (af-markdown turns it into an
 *   anchor id); strong, em, s, code, `a href [title]` (no target or rel; `data-mx-link` when the caller classifies
 *   it); br; blockquote; hr; code blocks through ./code-block.ts's renderCodeBlock (today's highlighting).
 * - Lists: `ul`/`ol [start]` with `data-tight="true"` on a tight list; every item holds its paragraphs as `<p>`
 *   (ProseMirror's list items always do), so a stylesheet gives a tight list's `li > p` today's spacing.
 * - Task lists: `ul.mx-md-check-list [data-tight]` > `li role="checkbox" aria-checked aria-disabled="true"`.
 * - Tables: `div.mx-md-table-scroll > table > tbody > tr > th|td`, alignment only as `style="text-align:..."`. The
 *   header row is `th` cells inside tbody: ProseMirror cannot split a table's rows into thead and tbody.
 * - Images: `img src alt [title] loading="lazy"`, src through the caller's image-address function.
 * Where documents' native-v1 codec (lib/live-regions/native-html.ts) writes an element differently, documents keep
 * theirs for now: task items there are `li data-type="taskItem" data-checked` in `ul data-type="taskList"`, list
 * items carry no tight mark, code blocks carry only `class="language-<as typed>"` without highlighting, links may
 * carry target and rel, nodes carry `data-af-id`, and there are no tables, strikethrough, images or heading anchors.
 */
import { escapeHtml, escapeText } from '@artifactbin/utils/escape';
import { renderCodeBlock } from './code-block';
import type { AsyncRenderOptions, MarkdownDoc, MarkdownMark, MarkdownNode, RenderOptions } from './types';

interface State { options: RenderOptions; heading: number }
const attr = (name: string, value: unknown) => (value == null ? '' : ` ${name}="${escapeHtml(String(value))}"`);
const sameMark = (a: MarkdownMark, b: MarkdownMark) => a.type === b.type && a.attrs?.href === b.attrs?.href && a.attrs?.title === b.attrs?.title;
const MARK_TAGS = { bold: 'strong', italic: 'em', strike: 's', code: 'code', link: 'a' } as const;

function openMark(mark: MarkdownMark, state: State): string {
  if (mark.type !== 'link') return `<${MARK_TAGS[mark.type]}>`;
  const href = mark.attrs?.href ?? '';
  return `<a${attr('href', href)}${attr('title', mark.attrs?.title)}${attr('data-mx-link', state.options.classifyLink?.(href))}>`;
}

/** Inline nodes, keeping a mark's element open across neighbours that share it (as ProseMirror's view does). */
function inline(nodes: readonly MarkdownNode[], state: State): string {
  let out = '';
  const open: MarkdownMark[] = [];
  for (const node of nodes) {
    const marks = node.marks ?? [];
    let keep = 0;
    while (keep < open.length && keep < marks.length && sameMark(open[keep]!, marks[keep]!)) keep++;
    while (open.length > keep) out += `</${MARK_TAGS[open.pop()!.type]}>`;
    for (const mark of marks.slice(keep)) { out += openMark(mark, state); open.push(mark); }
    if (node.type === 'text') out += escapeText(node.text ?? '');
    else if (node.type === 'hardBreak') out += '<br>';
    else if (node.type === 'image') {
      const src = String(node.attrs?.src ?? '');
      out += `<img${attr('src', state.options.imageAddress ? state.options.imageAddress(src) : src)}${attr('alt', node.attrs?.alt ?? '')}${attr('title', node.attrs?.title)} loading="lazy">`;
    }
  }
  while (open.length) out += `</${MARK_TAGS[open.pop()!.type]}>`;
  return out;
}

const ALIGNS = new Set(['left', 'center', 'right']);
function block(node: MarkdownNode, state: State): string {
  const children = () => (node.content ?? []).map(child => block(child, state)).join('');
  const tight = node.attrs?.tight ? ' data-tight="true"' : '';
  switch (node.type) {
    case 'paragraph': return `<p>${inline(node.content ?? [], state)}</p>`;
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      const anchor = level <= 3 ? ` data-mx-markdown-heading="${state.heading++}"` : '';
      return `<h${level}${anchor}>${inline(node.content ?? [], state)}</h${level}>`;
    }
    case 'blockquote': return `<blockquote>${children()}</blockquote>`;
    case 'bulletList': return `<ul${tight}>${children()}</ul>`;
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return `<ol${start !== 1 ? attr('start', start) : ''}${tight}>${children()}</ol>`;
    }
    case 'listItem': return `<li>${children()}</li>`;
    case 'taskList': return `<ul class="mx-md-check-list"${tight}>${children()}</ul>`;
    case 'taskItem': return `<li role="checkbox" aria-checked="${node.attrs?.checked === true}" aria-disabled="true">${children()}</li>`;
    case 'codeBlock': return renderCodeBlock((node.content ?? []).map(text => text.text ?? '').join(''), node.attrs?.language as string | null | undefined);
    case 'horizontalRule': return '<hr>';
    case 'table': return `<div class="mx-md-table-scroll"><table><tbody>${children()}</tbody></table></div>`;
    case 'tableRow': return `<tr>${children()}</tr>`;
    case 'tableHeader': case 'tableCell': {
      const tag = node.type === 'tableHeader' ? 'th' : 'td';
      const align = ALIGNS.has(node.attrs?.align as string) ? ` style="text-align:${node.attrs!.align}"` : '';
      return `<${tag}${align}>${inline(node.content ?? [], state)}</${tag}>`;
    }
    default: return node.content ? children() : inline([node], state);
  }
}

/** The document as the shared markup. */
export function renderHtml(doc: MarkdownDoc, options: RenderOptions = {}): string {
  const state: State = { options, heading: 0 };
  return doc.content.map(node => block(node, state)).join('');
}

function each(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  visit(node);
  for (const child of node.content ?? []) each(child, visit);
}

/** As renderHtml, with an image-address function that may be asynchronous: each distinct source is asked once. */
export async function renderHtmlAsync(doc: MarkdownDoc, options: AsyncRenderOptions = {}): Promise<string> {
  const { imageAddress, ...rest } = options;
  if (!imageAddress) return renderHtml(doc, rest);
  const sources: string[] = [];
  each(doc, node => { if (node.type === 'image' && !sources.includes(String(node.attrs?.src ?? ''))) sources.push(String(node.attrs?.src ?? '')); });
  const addresses = new Map(await Promise.all(sources.map(async src => [src, await imageAddress(src)] as const)));
  return renderHtml(doc, { ...rest, imageAddress: src => addresses.get(src) ?? src });
}

const inlineText = (nodes: readonly MarkdownNode[] = []): string => nodes.map(node =>
  node.type === 'text' ? node.text ?? '' : node.type === 'hardBreak' ? '\n' : node.type === 'image' ? String(node.attrs?.alt ?? '') : '').join('');
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'tableHeader', 'tableCell']);
function blockText(node: MarkdownNode): string {
  if (TEXTBLOCKS.has(node.type)) return inlineText(node.content);
  if (node.type === 'codeBlock') return inlineText(node.content);
  if (node.type === 'tableRow') return (node.content ?? []).map(blockText).join(' ');
  return (node.content ?? []).map(blockText).filter(Boolean).join('\n');
}

/** The text with the markup taken off, for compact previews: each block and line break on its own line. */
export function plainText(doc: MarkdownDoc): string {
  return blockText(doc);
}

/** Headings 1-3 in document order: `index` is the number renderHtml writes as `data-mx-markdown-heading`. */
export function headings(doc: MarkdownDoc): Array<{ level: 1 | 2 | 3; title: string; index: number }> {
  const found: Array<{ level: 1 | 2 | 3; title: string; index: number }> = [];
  each(doc, node => {
    const level = Number(node.attrs?.level);
    if (node.type === 'heading' && level >= 1 && level <= 3) found.push({ level: level as 1 | 2 | 3, title: inlineText(node.content), index: found.length });
  });
  return found;
}
