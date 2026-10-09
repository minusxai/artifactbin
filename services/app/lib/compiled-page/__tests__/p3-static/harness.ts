/**
 * PHASE 3 PROBE HARNESS: a corpus document → CompileInput (the compiler tests' own preparation), and the two
 * comparisons the probe reports — shape diffs (kit-parity `shapeOf`/`diffShapes`, what a reader would notice)
 * and byte diffs (token by token, each classified by its cause).
 */
import { createHash } from 'node:crypto';
import { loadCompilerBuild } from '../../build.server';
import type { CompileInput } from '../../contract';
import { prepareStoryParts } from '@/lib/story/prepared/prepare-runtime.server';
import { compileDataflow, prepareCompile, type ImportSource } from '@/lib/dataflow/compile-dataflow';
import { dataflowOf, splitHelmet } from '@/lib/document/helmet';
import type { Dataflow } from '@/lib/dataflow/dataflow';
import type { JsxNode } from '@/lib/jsx';
import { parseJsx } from '@/lib/jsx';
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
