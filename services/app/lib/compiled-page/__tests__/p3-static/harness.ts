/**
 * PHASE 3 PROBE HARNESS: a corpus document → CompileInput (the compiler tests' own preparation), and the two
 * comparisons the probe reports — shape diffs (kit-parity `shapeOf`/`diffShapes`, what a reader would notice)
 * and byte diffs (token by token, each classified by its cause).
 */
import { createHash } from 'node:crypto';
import { loadCompilerBuild } from '../../build.server';
import type { CompileInput } from '../../contract';
import { prepareStoryParts } from '@/lib/story/prepared/prepare-runtime.server';
import { compileDataflow, prepareCompile, type ImportSource } from '@/lib/story/data/compile-dataflow';
import { dataflowOf, splitHelmet } from '@/lib/story/document/helmet';
import type { Dataflow } from '@/lib/story/data/dataflow';
import type { JsxNode } from '@/lib/jsx';
import { parseJsx } from '@/lib/jsx';
import { shapeOf, diffShapes } from '@/lib/islands/__tests__/kit-parity';
import { parseFragment } from 'parse5';
import { KITCHEN_REFS, type CorpusDoc } from './corpus';

const SOURCES: Record<string, ImportSource> = {
  SALES1: { kind: 'dataset', tables: [{ name: 'rows', columns: [{ name: 'month', type: 'date' }, { name: 'region', type: 'string' }, { name: 'product', type: 'string' }, { name: 'revenue', type: 'number' }, { name: 'units', type: 'number' }] }] },
  [KITCHEN_REFS.dataset]: { kind: 'dataset', tables: [{ name: 'rows', columns: [{ name: 'month', type: 'date' }, { name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }] }] },
};

async function compiledFlow(declared: Dataflow, body: JsxNode[]) {
  const result = compileDataflow(declared, await prepareCompile(declared, async (ref) => SOURCES[ref] ?? null), body);
  if (!result.ok) throw new Error(`corpus dataflow does not compile: ${result.errors.map((e) => e.message).join('; ')}`);
  return result.compiled;
}

export async function inputOf(doc: CorpusDoc): Promise<CompileInput> {
  const { runtime } = await prepareStoryParts({ source: doc.markup, compiledCss: null, theme: null, colorMode: 'light', title: 't', template: doc.template, refData: {}, assetUrls: new Set() });
  const parsed = parseJsx(doc.markup) as { nodes: JsxNode[] };
  const { content, body } = splitHelmet(parsed.nodes);
  const declared = dataflowOf(content);
  const flow = declared.imports.length || declared.values.length || declared.queries.length ? await compiledFlow(declared, body) : null;
  return { nodes: runtime.data.nodes, colorMode: 'light', template: doc.template, chrome: true, glyphs: runtime.data.glyphs, refData: {}, flow, build: loadCompilerBuild().id };
}

export const sha = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

export const shapeDiffs = (react: string, solid: string): string[] => diffShapes(shapeOf(react), shapeOf(solid));

interface HtmlNode { nodeName: string; tagName?: string; value?: string; data?: string; attrs?: Array<{ name: string; value: string; namespace?: string }>; childNodes?: HtmlNode[]; content?: { childNodes: HtmlNode[] } }
interface DomEntry { path: string; value: string; scriptPayload: boolean }

function parsedEntries(html: string): { dom: DomEntry[]; comments: string[] } {
  const root = parseFragment(html) as unknown as HtmlNode;
  const dom: DomEntry[] = [], comments: string[] = [];
  const walk = (parent: HtmlNode, path: string, inScript = false): void => {
    const children = parent.content?.childNodes ?? parent.childNodes ?? [];
    let index = 0, textValue = '';
    const flushText = (): void => {
      if (textValue) dom.push({ path: `${path}/${index++}`, value: `text:${textValue}`, scriptPayload: inScript });
      textValue = '';
    };
    for (const child of children) {
      if (child.nodeName === '#comment') { comments.push(`${path}@${index}:${child.data ?? ''}`); continue; }
      if (child.nodeName === '#text') { textValue += child.value ?? ''; continue; }
      flushText();
      const childPath = `${path}/${index++}`;
      const attrs = (child.attrs ?? []).map((attr) => [attr.namespace ?? '', attr.name, attr.value] as const)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      dom.push({ path: childPath, value: JSON.stringify([child.nodeName, attrs]), scriptPayload: child.tagName === 'script' && child.attrs?.some((attr) => attr.name === 'data-mx-island-literals') === true });
      walk(child, childPath, child.tagName === 'script' && child.attrs?.some((attr) => attr.name === 'data-mx-island-literals'));
    }
    flushText();
  };
  walk(root, '');
  return { dom, comments };
}

/** Exact parsed DOM, aside from attribute order and adjacent text-node boundaries; comments stay separate. */
export function parsedDomDiffs(react: string, solid: string): { dom: string[]; hydrationKeys: string[]; generatedIds: string[]; scripts: string[]; comments: string[] } {
  const a = parsedEntries(react), b = parsedEntries(solid);
  const dom: string[] = [], hydrationKeys: string[] = [], generatedIds: string[] = [], scripts: string[] = [], comments: string[] = [];
  const entries = new Map<string, [DomEntry | undefined, DomEntry | undefined]>();
  for (const entry of a.dom) entries.set(entry.path, [entry, undefined]);
  for (const entry of b.dom) {
    const pair = entries.get(entry.path);
    if (pair) pair[1] = entry;
    else entries.set(entry.path, [undefined, entry]);
  }
  for (const [path, [left, right]] of entries) if (left?.value !== right?.value) {
    const describe = (value?: string): string => {
      if (!value) return '(none)';
      if (value.startsWith('text:')) return value.length > 180 ? `${value.slice(0, 180)}…` : value;
      const [tag, attrs] = JSON.parse(value) as [string, Array<[string, string, string]>];
      return `${tag} ${attrs.map(([ns, name, val]) => `${ns ? `${ns}:` : ''}${name}=${JSON.stringify(val)}`).join(' ')}`;
    };
    const diff = `${path}: ${describe(left?.value)} -> ${describe(right?.value)}`;
    if (left?.scriptPayload || right?.scriptPayload) scripts.push(diff);
    else {
      dom.push(diff);
      // Classification only: the exact DOM diff above remains counted. Hydration keys are deliberately
      // not ignored by the comparison because they can matter to island boot.
      if (left?.value && right?.value && !left.value.startsWith('text:') && !right.value.startsWith('text:')) {
        const [lt, la] = JSON.parse(left.value) as [string, Array<[string, string, string]>];
        const [rt, ra] = JSON.parse(right.value) as [string, Array<[string, string, string]>];
        const withoutKey = (attrs: Array<[string, string, string]>) => attrs.filter(([, name]) => name !== 'data-hk');
        if (lt === rt && JSON.stringify(withoutKey(la)) === JSON.stringify(withoutKey(ra))) hydrationKeys.push(diff);
        const generatedRef = ([, name, value]: [string, string, string]): boolean =>
          (name === 'aria-controls' || name === 'aria-labelledby') && /^(?:radix-_R_\d+_|mx-preview-|\d+-)/.test(value);
        const withoutGenerated = (attrs: Array<[string, string, string]>) => attrs.filter((entry) => !generatedRef(entry));
        if (lt === rt && !hydrationKeys.includes(diff)
          && la.some(generatedRef) && ra.some(generatedRef)
          && JSON.stringify(withoutGenerated(la)) === JSON.stringify(withoutGenerated(ra))) generatedIds.push(diff);
      }
    }
  }
  for (let i = 0; i < Math.max(a.comments.length, b.comments.length); i++) {
    if (a.comments[i] !== b.comments[i]) comments.push(`${a.comments[i] ?? '(none)'} -> ${b.comments[i] ?? '(none)'}`);
  }
  return { dom, hydrationKeys, generatedIds, scripts, comments };
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
/** The character references either renderer writes, decoded. */
const decodeHTML = (text: string): string => text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) =>
  ref[0] === '#' ? String.fromCodePoint(ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1))) : NAMED[ref] ?? whole);

/** Markup split into tags and text runs. */
function tokens(html: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < html.length;) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      out.push(html.slice(i, end < 0 ? html.length : end + 3));
      i = end < 0 ? html.length : end + 3;
    } else if (html[i] === '<') {
      let end = i + 1, quote = '';
      for (; end < html.length; end++) {
        const c = html[end]!;
        if (quote) { if (c === quote) quote = ''; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '>') { end++; break; }
      }
      out.push(html.slice(i, end)); i = end;
    } else {
      const end = html.indexOf('<', i + 1);
      out.push(html.slice(i, end < 0 ? html.length : end));
      i = end < 0 ? html.length : end;
    }
  }
  return out;
}

type Tag = { name: string; close: boolean; attrs: Array<[string, string | null]>; selfClosing: boolean };
function parseTag(token: string): Tag | null {
  const m = /^<(\/?)([a-zA-Z][\w:-]*)([\s\S]*?)(\/?)>$/.exec(token);
  if (!m) return null;
  const attrs: Array<[string, string | null]> = [];
  for (const a of m[3]!.matchAll(/([^\s=/]+)(?:="([^"]*)")?/g)) attrs.push([a[1]!, a[2] === undefined ? null : decodeHTML(a[2])]);
  return { name: m[2]!.toLowerCase(), close: m[1] === '/', attrs, selfClosing: m[4] === '/' };
}

/** Why two differing tokens differ (the first rule that explains the whole difference). */
function classify(a: string, b: string): string {
  const stripHk = (t: string) => t.replace(/\sdata-hk="[^"]*"/g, '');
  if (stripHk(a) === stripHk(b)) return 'data-hk';
  if (!a.startsWith('<') && !b.startsWith('<')) return decodeHTML(a) === decodeHTML(b) ? 'text escaping' : 'text content';
  const x = parseTag(stripHk(a)), y = parseTag(stripHk(b));
  if (!x || !y) return 'markup';
  if (x.name !== y.name || x.close !== y.close) return 'element';
  const norm = (attrs: Array<[string, string | null]>) => attrs.map(([n, v]) => `${n}=${v ?? ''}`);
  const [na, nb] = [norm(x.attrs), norm(y.attrs)];
  const sameList = na.join('\u0000') === nb.join('\u0000');
  const sameSet = [...na].sort().join('\u0000') === [...nb].sort().join('\u0000');
  if (sameList && x.selfClosing !== y.selfClosing) return 'void self-closing';
  if (sameList) {
    const booleanForm = x.attrs.some(([n, v], i) => (v === null) !== (y.attrs[i]![1] === null) && n === y.attrs[i]![0]);
    return booleanForm ? 'boolean attribute form' : 'attribute escaping';
  }
  if (sameSet) return x.selfClosing !== y.selfClosing ? 'attribute order + void self-closing' : 'attribute order';
  return 'attribute value';
}

export interface ByteReport { equal: boolean; tokens: number; diffs: number; byCause: Record<string, number>; samples: Array<{ cause: string; react: string; solid: string }> }

/** Token-by-token comparison of the two HTML strings, each differing pair classified. */
export function byteDiffs(react: string, solid: string, samples = 6): ByteReport {
  const a = tokens(react), b = tokens(solid);
  const byCause: Record<string, number> = {};
  const out: ByteReport['samples'] = [];
  let diffs = 0;
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    const x = a[i] ?? '', y = b[j] ?? '';
    if (x === y) { i++; j++; continue; }
    // Solid may add a comment separator. Find a nearby common token before pairing later elements.
    let skipA = 0, skipB = 0;
    for (let d = 1; d <= 12; d++) {
      if (!skipA && a[i + d] === y) skipA = d;
      if (!skipB && b[j + d] === x) skipB = d;
      if (skipA || skipB) break;
    }
    if (skipA || skipB) {
      const skip = skipA && (!skipB || skipA <= skipB) ? skipA : skipB;
      const cause = skipA && (!skipB || skipA <= skipB) ? 'react-only token' : 'solid-only token';
      byCause[cause] = (byCause[cause] ?? 0) + skip;
      diffs += skip;
      if (out.filter((s) => s.cause === cause).length < samples) out.push({ cause, react: x.slice(0, 400), solid: y.slice(0, 400) });
      if (cause === 'react-only token') i += skip; else j += skip;
      continue;
    }
    diffs++;
    const cause = !x || !y ? 'token count' : classify(x, y);
    byCause[cause] = (byCause[cause] ?? 0) + 1;
    if (out.filter((s) => s.cause === cause).length < samples) out.push({ cause, react: x.slice(0, 400), solid: y.slice(0, 400) });
    i++; j++;
  }
  return { equal: react === solid, tokens: Math.max(a.length, b.length), diffs, byCause, samples: out };
}
