/**
 * THE OFFLINE FILE'S BACKEND — the ArtifactBackend (lib/artifact-backend/types)
 * a downloaded `.html` answers from its own ArtifactFile, so the site's editor
 * and comments run in the file unchanged.
 *
 * It holds the file as it is NOW and hands every new state to `onChange` (the
 * page keeps it for Save and the crash buffer). There is one writer — whoever
 * has the file open — but the edit contract is kept honest anyway: an update
 * is applied exactly as /edits applies it (the graph patch, or the whole
 * replacement, under the server's reference model), and a stale one gets the
 * server's conflict answer.
 *
 * What needs artifactbin says so through `unavailable()` (the controls render
 * disabled with that reason) and the matching requests reject with it. Nothing
 * here opens a connection: the file's CSP would refuse it anyway.
 */
import type { DocumentGraph, DocumentResourcePreparation, DocumentUpdate } from '@artifactbin/contracts';
import type { AnnotationCommentWire, AnnotationWire } from '@/lib/annotations';
import { ANNOTATION_ANCHOR_ATTR } from '@/lib/annotation-anchors';
import { BackendRequestError } from '@/lib/artifact-backend/errors';
import type { ArtifactBackend, BackendFeature, EditAnswer, FlushResponse, LoadedArtifact } from '@/lib/artifact-backend/types';
import { compileStoryCss } from '@/lib/data/story/story-css.server';
import { parseJsx } from '@/lib/jsx/parse';
import { serializeJsx } from '@/lib/jsx/serialize';
import type { JsxElement, JsxNode } from '@/lib/jsx/types';
import type { StoryIslandData } from '@/lib/story-runtime/contract';
import type { QueryTransport } from '@/lib/story-runtime/store';
import { canonicalQuote, canonicalText } from '@/lib/story/annotation-range';
import { isWebUrl } from '@/lib/story/asset-url';
import { EMPTY_DATAFLOW, isEmptyDataflow, type Dataflow, type DataflowState, type QueryDecl } from '@/lib/story/dataflow';
import { EMPTY_COMPILED_DATAFLOW, type CompiledDataflow } from '@/lib/story/compiled-dataflow';
import { declarationsOf } from '@/lib/story/helmet';
import { createDocumentGraph, graphNodes, graphSource, type GraphAstNode } from '@/lib/story/document-graph';
import { applyGraphPatch } from '@/lib/story/document-graph-patch';
import { needsAuthoringContext, prepareClientDocumentReplacement } from '@/lib/story/document-update-client';
import { documentAfterOperation } from '@/lib/story/document-update-history';
import { sourcePathToBodyPath } from '@/lib/story/edit-compose';
import { collectExternalAssetUrls } from '@/lib/story/external-images';
import { storyUpdateParts } from '@/lib/story/update-parts';
import {
  OFFLINE_ASSET_REASON, OFFLINE_QUERY_REASON, sourceDigest, type ArtifactFile, type ArtifactFileEdit,
} from './file-format';
import { createSnapshotTransport } from './snapshot-transport';

/** Why each feature is unavailable in a file, shown where its control would work. */
export const OFFLINE_REASONS: Record<BackendFeature, string> = {
  runQueries: OFFLINE_QUERY_REASON,
  webAssets: OFFLINE_ASSET_REASON,
  versions: 'Version history lives on artifactbin. Open the live version.',
  mentions: 'Mentions need a connection.',
  commentImages: 'Screenshots need a connection.',
  remoteSessions: 'Agents need a connection.',
  live: 'Live updates need a connection.',
};

/** The refusal for deleting a comment that came from artifactbin. */
export const LOCAL_DELETE_ONLY = 'Only comments made in this file can be deleted here.';

/** Who wrote a journal entry or a comment when nobody picked a name. */
export const UNNAMED_AUTHOR = 'Someone';

export interface FileBackendHooks {
  /** Every new state of the file: an edit, a comment, a reply, a status change. */
  onChange(file: ArtifactFile): void;
  /** The name picked in this file, or null when nobody has picked one. */
  author(): string | null;
}

const refuse = (feature: BackendFeature) => Promise.reject(new BackendRequestError(OFFLINE_REASONS[feature], 503));

// ── the island, kept in step with the source ────────────────────────────────

const ASSET_ADDRESS = /\/assets\/([0-9a-f]{64})(?:\?[^\s"'()<>,\\]*)?/g;

/**
 * The `data:` URI the download inlined for each web asset, recovered by walking
 * the file's own island beside the same source rendered with every web URL
 * mapped to its `/assets/<hash>` address (the editor's own mapping, HELD
 * assets = every web URL). The two trees have one shape when the island was
 * built from this source; only those values differ. When it was NOT (the
 * source was changed outside the file), elements are matched by their node
 * `id` first, so an image that moved still finds its bytes, and a pair whose
 * tag or id disagrees is never read.
 */
function inlinedAssets(source: string, island: JsxNode[]): Map<string, string> {
  const found = new Map<string, string>();
  const mapped = storyUpdateParts(source, isWebUrl)?.nodes;
  if (!mapped) return found;
  const idOf = (node: JsxElement): string | null => {
    const value = node.attributes.find((a) => a.name === 'id')?.value;
    return value?.static && typeof value.json === 'string' ? value.json : null;
  };
  const byId = new Map<string, JsxElement>();
  const index = (nodes: JsxNode[]) => { for (const node of nodes) if (node.type === 'element') { const id = idOf(node); if (id && !byId.has(id)) byId.set(id, node); index(node.children); } };
  index(island);
  const read = (x: JsxElement, y: JsxElement) => {
    for (const attr of x.attributes) {
      if (!attr.value.static || typeof attr.value.json !== 'string') continue;
      const other = y.attributes.find((candidate) => candidate.name === attr.name)?.value;
      if (!other?.static || typeof other.json !== 'string' || !other.json.startsWith('data:')) continue;
      for (const match of attr.value.json.matchAll(ASSET_ADDRESS)) found.set(match[1]!, other.json);
    }
  };
  const pair = (a: JsxNode[], b: JsxNode[]) => {
    for (let i = 0; i < a.length; i++) {
      const x = a[i]!;
      if (x.type !== 'element') continue;
      const id = idOf(x);
      const positional = b[i];
      const y = (id ? byId.get(id) : undefined)
        ?? (positional?.type === 'element' && positional.tag === x.tag && idOf(positional) === id ? positional : undefined);
      if (!y || y.tag !== x.tag) continue;
      read(x, y);
      pair(x.children, y.children);
    }
  };
  pair(mapped, island);
  return found;
}

/** Every `/assets/<hash>` address the file holds bytes for, swapped for those bytes, anywhere in a JSON value. */
function withInlinedAssets<T>(value: T, assets: ReadonlyMap<string, string>): T {
  if (!assets.size) return value;
  return JSON.parse(JSON.stringify(value).replace(ASSET_ADDRESS, (address, hash: string) => assets.get(hash) ?? address)) as T;
}

/**
 * For the page that hosts the editor: the editor pushes each new version of
 * the document to the runtime with every web image at its `/assets/<hash>`
 * address (InPlaceEditor's HELD_ASSETS — right on the site, a request the
 * file's CSP refuses offline). This puts the bytes the file carries back in
 * their place, in whatever the editor sends.
 */
export function fileAssetInliner(file: Pick<ArtifactFile, 'source' | 'island'>): <T>(value: T) => T {
  const assets = inlinedAssets(file.source, file.island.nodes);
  return (value) => withInlinedAssets(value, assets);
}

// ── comments' anchors, against the current source ───────────────────────────

interface Anchored { node: JsxElement; path: string }

const anchorKeyOf = (node: JsxElement): string | null => {
  const attr = node.attributes.find((a) => a.name === 'id') ?? node.attributes.find((a) => a.name === ANNOTATION_ANCHOR_ATTR);
  return attr && attr.value.static && typeof attr.value.json === 'string' ? attr.value.json : null;
};

/** Every anchor-carrying element, by key, with its SOURCE path — first occurrence wins, as on the server. */
function anchorIndex(source: string): Map<string, Anchored> {
  const out = new Map<string, Anchored>();
  const parsed = parseJsx(source);
  if (!parsed.ok) return out;
  const walk = (nodes: JsxNode[], prefix: string) => nodes.forEach((node, i) => {
    if (node.type !== 'element') return;
    const path = prefix ? `${prefix}.${i}` : String(i);
    const key = anchorKeyOf(node);
    if (key && !out.has(key)) out.set(key, { node, path });
    walk(node.children, path);
  });
  walk(parsed.nodes, '');
  return out;
}

const textOf = (node: JsxNode): string =>
  node.type === 'text' ? node.value : node.type === 'element' ? node.children.map(textOf).join('') : '';
const snippetOf = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * A thread as the server would read it back now: anchor, snippet and quote
 * resolved against `source`. The STORED thread keeps the anchor it was made
 * with (the server keeps its anchor key the same way), so a node that comes
 * back re-anchors its thread.
 */
function anchoredThread(thread: AnnotationWire, source: string, anchors: Map<string, Anchored>): AnnotationWire {
  const key = thread.anchor?.nodeId ?? thread.anchor?.key ?? null;
  const found = key ? anchors.get(key) : undefined;
  const bodyPath = found ? sourcePathToBodyPath(source, found.path) : null;
  if (!found || bodyPath === null) return { ...thread, anchor: null, orphaned: true, quote_found: thread.quote ? false : null };
  return {
    ...thread,
    anchor: { key: key!, nodeId: key!, path: bodyPath, spanStart: found.node.start, spanEnd: found.node.end },
    orphaned: false,
    snippet: snippetOf(source.slice(found.node.start, found.node.end)),
    quote_found: thread.quote ? canonicalText(textOf(found.node)).includes(thread.quote) : null,
  };
}

// ── the journal's one line ──────────────────────────────────────────────────

/** "Edited text in 'Where the money went'": what kind of change, under which heading. */
function editSummary(before: DocumentGraph, after: DocumentGraph, update: DocumentUpdate, title: string): string {
  const meta = update.metadata ?? {};
  const patch = update.patch;
  const inserted = Object.keys(patch.inserted), removed = patch.removed, updated = Object.keys(patch.updated);
  const content = inserted.length + removed.length + updated.length > 0 || !!update.whole;
  if (!content) {
    if (typeof meta.title === 'string') return `Renamed to '${meta.title}'`;
    if ('theme' in meta || 'template' in meta || 'colorMode' in meta) return 'Changed the look';
    return 'Edited';
  }
  // Whitespace between elements is re-minted freely by the source matcher; it is never what someone changed.
  const added = inserted.filter((key) => meaningful(after, key));
  const dropped = removed.filter((key) => meaningful(before, key));
  const own = updated.filter((key) => !isStructuralOnly(patch, key) && meaningful(before, key));
  const verb = update.whole ? 'Rewrote the document'
    : added.length && !dropped.length && !own.length ? 'Added content'
      : dropped.length && !added.length && !own.length ? 'Removed content'
        : own.length && !added.length && !dropped.length && own.every((key) => nodeOf(before, key)?.type === 'text') ? 'Edited text'
          : 'Edited';
  // The heading the change sits under, in the document as it is now (or as it was, for a removal).
  const changed = new Set([...added, ...own, ...dropped]);
  const heading = headingOver(after, changed) ?? headingOver(before, changed) ?? title;
  return heading ? `${verb} in '${heading}'` : verb;
}

/** An element, or text that is more than the whitespace between elements. */
const meaningful = (graph: DocumentGraph, key: string): boolean => {
  const node = nodeOf(graph, key);
  return !!node && (node.type !== 'text' || node.value.trim() !== '');
};
/** A node whose only write is its list of children: the parent of an insert or a removal, not a change of its own. */
const isStructuralOnly = (patch: DocumentUpdate['patch'], key: string): boolean => {
  const write = patch.updated[key];
  return !!write && !write.self && write.children;
};

function nodeOf(graph: DocumentGraph, key: string): GraphAstNode | null {
  let found: GraphAstNode | null = null;
  const walk = (nodes: GraphAstNode[]) => { for (const node of nodes) { if (found) return; if (node.graphKey === key) { found = node; return; } if (node.type === 'element') walk(node.children); } };
  walk(graphNodes(graph));
  return found;
}

function headingOver(graph: DocumentGraph, changed: Set<string>): string | null {
  let last: string | null = null;
  let answer: string | null = null;
  const walk = (nodes: GraphAstNode[]): boolean => {
    for (const node of nodes) {
      if (node.type === 'element' && /^h[1-6]$/i.test(node.tag)) last = canonicalText(textOf(node)).slice(0, 80) || last;
      if (node.graphKey && changed.has(node.graphKey)) { answer = last; return true; }
      if (node.type === 'element' && walk(node.children)) return true;
    }
    return false;
  };
  walk(graphNodes(graph));
  return answer;
}

// ── what an edit would need from artifactbin ────────────────────────────────

/** The server-bound inputs a source names: asset URLs, ref: targets, data bindings, icons and fonts. */
function authoringInputs(source: string): Set<string> {
  const out = new Set<string>();
  for (const url of collectExternalAssetUrls(source).all) out.add(`url:${url}`);
  const parsed = parseJsx(source);
  if (!parsed.ok) return out;
  const walk = (nodes: JsxNode[]) => {
    for (const node of nodes) {
      if (node.type !== 'element' || node.tag === 'Iframe') continue;
      for (const attr of node.attributes) {
        if (attr.value.static && typeof attr.value.json === 'string' && attr.value.json.startsWith('ref:')) out.add(`ref:${attr.value.json}`);
      }
      if (['Query', 'Mutation', 'Question'].includes(node.tag)) {
        const binding = node.attributes.find((a) => a.name === 'source')?.value;
        if (binding) out.add(`bind:${JSON.stringify(binding.static ? binding.json : binding.source)}`);
      }
      if (node.tag === 'Icon' || node.tag === 'meta') out.add(`el:${serializeJsx([{ ...node, attributes: node.attributes.filter((a) => a.name !== 'id') }])}`);
      walk(node.children);
    }
  };
  walk(parsed.nodes);
  return out;
}

// ── queries: the snapshot answers only what the download ran ────────────────

const sameQuery = (a: QueryDecl | undefined, b: QueryDecl) => !!a && a.sql === b.sql && (a.source ?? null) === (b.source ?? null);

/** Names of the queries in `flow` whose SQL or source differs from what the snapshot ran (or that it never ran). */
function unranQueries(flow: Dataflow, ran: Dataflow): Set<string> {
  const before = new Map(ran.queries.map((q) => [q.name, q]));
  return new Set(flow.queries.filter((q) => !sameQuery(before.get(q.name), q)).map((q) => q.name));
}

// ── what a source derives: exactly what a commit rebuilds ──────────────────

/** The same stylesheet, whatever its url()s point at (the download inlined them as data: URIs). */
const styleShape = (css: string | null) => css === null ? null : css.replace(/url\(\s*(['"]?)[^)'"]*\1\s*\)/g, 'url()');

/**
 * The island and stylesheets `source` derives, as a commit derives them: the
 * body and dataflow from the one update-parts builder, web images given back
 * the bytes the file carries, the Tailwind sheet compiled in the browser
 * (`css`: when the classes may have changed), the author's `<style>` taken
 * from the source unless it is the one the file already has inlined.
 */
async function derive(
  file: ArtifactFile, source: string, metadata: ArtifactFile['metadata'], assets: ReadonlyMap<string, string>,
  { css, priorStyle }: { css: boolean; priorStyle: (style: string | null) => boolean },
): Promise<Pick<ArtifactFile, 'css' | 'island' | 'derivedFrom'>> {
  const parts = storyUpdateParts(source, isWebUrl);
  const compiled = css || !file.css.compiled ? await compileStoryCss(source, { force: true }) : file.css.compiled;
  const island: StoryIslandData = {
    ...file.island,
    ...(parts ? { nodes: withInlinedAssets(parts.nodes, assets) } : {}),
    ...(metadata.colorMode ? { colorMode: metadata.colorMode } : {}),
  };
  // The file has no compiler: the island keeps the declarations the download
  // compiled, and a query edited since answers OFFLINE_QUERY_REASON
  // (snapshotStateFor). A source that now declares nothing has no dataflow.
  const declared = declarationsOf(source);
  if (parts && declared && isEmptyDataflow(declared)) delete island.dataflow;
  const style = parts?.authorCss ?? null;
  return {
    css: { ...file.css, compiled, author: priorStyle(style) ? file.css.author : style },
    island,
    derivedFrom: sourceDigest(source),
  };
}

/** The journal line for a source changed outside the file (by hand, or by an agent), rebuilt when it was opened. */
export const CHANGED_OUTSIDE = 'Changed outside the file';

/** True when `source` is not the one the island and stylesheets were built from. */
export function sourceChangedOutside(file: ArtifactFile): boolean {
  return typeof file.derivedFrom === 'string' && sourceDigest(file.source) !== file.derivedFrom;
}

export interface RebuildResult {
  /** The file to open: rebuilt from its source, or unchanged when that could not be done. */
  file: ArtifactFile;
  /** True when `file` differs from the file as it was stored (and wants saving). */
  rebuilt: boolean;
  /** Why the changed source could not be used — the validator's words; the file keeps its last good render. */
  error: string | null;
}

/**
 * When the file was opened with a source changed outside it: validate that
 * source as a commit does (the browser's own document-update compiler — parse,
 * repair, canonical form, node ids, structure and scope) and refuse what needs
 * artifactbin as a commit in the file does, then rebuild everything derived
 * from it and add CHANGED_OUTSIDE to the journal. A source that fails leaves the
 * file exactly as it is, with the reason.
 */
export async function rebuildArtifactFile(file: ArtifactFile, author: string | null = null): Promise<RebuildResult> {
  if (!sourceChangedOutside(file)) return { file, rebuilt: false, error: null };
  const version = file.base.version + file.journal.length;
  let source: string;
  try {
    const update = prepareClientDocumentReplacement(file.source, version);
    source = update.replacement ? graphSource(update.replacement) : file.source;
  } catch (error) {
    return { file, rebuilt: false, error: error instanceof Error && error.message ? error.message : 'The source is not valid.' };
  }
  if (needsAuthoringContext(source)) {
    /*
     * What the download could resolve: the inputs its source named (every
     * commit in the file was held to those, so any source it saved names no
     * more), and the refs its island carries.
     */
    const have = authoringInputs(file.base.source);
    for (const id of Object.keys(file.island.refData ?? {})) have.add(`ref:ref:${id}`);
    for (const input of authoringInputs(source)) if (!have.has(input)) return { file, rebuilt: false, error: OFFLINE_ASSET_REASON };
  }
  const derived = await derive(file, source, file.metadata, inlinedAssets(source, file.island.nodes), {
    css: true,
    // The source is all there is to go on: keep the inlined sheet only when it is the same sheet.
    priorStyle: (style) => styleShape(style) === styleShape(file.css.author),
  });
  const entry: ArtifactFileEdit = { at: new Date().toISOString(), by: author?.trim() || UNNAMED_AUTHOR, summary: CHANGED_OUTSIDE };
  return { file: { ...file, source, ...derived, journal: [...file.journal, entry] }, rebuilt: true, error: null };
}

/**
 * The declarations the snapshot was taken over: the DOWNLOADED source's
 * (`base.source`, which nothing in the file changes). Not the island's, which
 * follows every edit — in the file, or outside it — so an edited query would
 * otherwise be answered with the rows the old SQL returned.
 */
function ranFlowOf(file: ArtifactFile): Dataflow {
  return declarationsOf(file.base.source) ?? EMPTY_DATAFLOW;
}

/**
 * The state the page seeds the runtime with: the snapshot, minus the results
 * of any query whose SQL or source is no longer what the download ran — those
 * say OFFLINE_QUERY_REASON, as the transport answers them.
 */
export function snapshotStateFor(file: ArtifactFile): DataflowState {
  const state = file.snapshot.state;
  if (!file.island.dataflow?.flow) return state;
  const unran = unranQueries(declarationsOf(file.source) ?? EMPTY_DATAFLOW, ranFlowOf(file));
  if (!unran.size) return state;
  const tables = Object.fromEntries(Object.entries(state.tables).filter(([name]) => !unran.has(name)));
  const errors = { ...state.errors };
  for (const name of unran) errors[name] = OFFLINE_QUERY_REASON;
  return { ...state, tables, errors };
}

// ── the backend ─────────────────────────────────────────────────────────────

export function createFileBackend(initial: ArtifactFile, hooks: FileBackendHooks): ArtifactBackend {
  let file = initial;
  /**
   * ONE graph for the life of the page: its internal keys are minted once, and
   * every patch names them. Null for a source that does not parse (changed
   * outside the file and not rebuilt): the page offers no editing then, and
   * the document requests below say why.
   */
  let unreadable: string | null = null;
  let graph = ((): DocumentGraph => {
    try { return createDocumentGraph(file.source, file.base.version + file.journal.length, { preserveSource: true }); } catch (error) {
      unreadable = error instanceof Error && error.message ? error.message : 'The source does not parse.';
      return createDocumentGraph('', file.base.version + file.journal.length);
    }
  })();
  let version = file.base.version + file.journal.length;
  let editId = file.journal.length || !file.base.editId ? `offline-${version}` : file.base.editId;
  /** What the snapshot was taken over — the declarations the download ran. */
  const ranFlow: Dataflow = ranFlowOf(initial);
  const assets = inlinedAssets(initial.source, initial.island.nodes);
  const created = new Map<string, string>();
  const author = () => hooks.author()?.trim() || UNNAMED_AUTHOR;
  const now = () => new Date().toISOString();
  const localId = () => `local-${globalThis.crypto.randomUUID()}`;

  const change = (next: ArtifactFile) => { file = next; hooks.onChange(file); };
  const currentFlow = (): CompiledDataflow => file.island.dataflow?.flow ?? EMPTY_COMPILED_DATAFLOW;

  const head = (): LoadedArtifact => ({
    id: file.artifactId,
    document: structuredClone(graph),
    format: 'markup',
    title: file.metadata.title,
    description: file.metadata.description,
    markup: file.source,
    theme: file.metadata.theme,
    template: file.metadata.template,
    colorMode: file.metadata.colorMode,
    version,
    edit_id: editId,
    refs: Object.entries(file.island.refData ?? {}).map(([id, ref]) => ({ id, kind: (ref as { kind?: string }).kind ?? 'unknown' })),
    compiledCss: file.css.compiled,
    dataflow: ranFlow.queries.length || ranFlow.values.length ? { flow: currentFlow(), state: file.snapshot.state } : null,
  });

  const conflict = (): EditAnswer => ({ ok: false, status: 409, body: { error: 'doc_changed', edit_id: editId, source: file.source, version } as FlushResponse });

  const threadsNow = (): AnnotationWire[] => {
    const anchors = anchorIndex(file.source);
    return file.threads.map((thread) => anchoredThread(thread, file.source, anchors));
  };
  const saveThreads = (threads: AnnotationWire[], localIds = file.localIds) => change({ ...file, threads, localIds });
  const findThread = (id: string): AnnotationWire => {
    const thread = threadsNow().find((t) => t.id === id);
    if (!thread) throw new BackendRequestError('That comment is no longer in this file.', 404);
    return thread;
  };

  return {
    mode: 'offline',
    unavailable: (feature) => OFFLINE_REASONS[feature],

    // ── the document ──────────────────────────────────────────────────────
    async load() {
      if (unreadable) throw new BackendRequestError(unreadable, 422);
      return head();
    },

    async commitEdit({ document_update: update }) {
      if (unreadable) return { ok: false, status: 422, body: { error: 'invalid_jsx', details: [{ message: unreadable }] } as unknown as FlushResponse };
      const nothing = !update.whole && !Object.keys(update.patch.updated).length && !Object.keys(update.patch.inserted).length
        && !update.patch.removed.length && !Object.keys(update.metadata ?? {}).length;
      if (nothing) return { ok: false, status: 400, body: { error: 'bad_diff', detail: 'identical' } as FlushResponse };
      // The metadata this update was prepared against must still be what the file says.
      const expected = update.expectedMetadata ?? {};
      if (Object.entries(expected).some(([key, value]) => (file.metadata[key as keyof ArtifactFile['metadata']] ?? null) !== (value ?? null))) return conflict();
      let next: DocumentGraph | null;
      if (update.whole) {
        if (!update.replacement || update.patch.baseVersion !== version) return conflict();
        next = documentAfterOperation(graph, { kind: 'operations', version: version + 1, forward: update.patch, replacement: update.replacement, beforeNodes: {}, beforeRevisions: {}, beforeBytes: graph.bytes });
      } else {
        next = applyGraphPatch(graph, version, update.patch);
      }
      if (!next) return conflict();

      const source = graphSource(next);
      const metadata = { ...file.metadata };
      for (const [key, value] of Object.entries(update.metadata ?? {})) {
        if (key === 'title' && typeof value === 'string') metadata.title = value;
        else if (key === 'description') metadata.description = (value as string | null) ?? null;
        else if (key === 'theme' || key === 'template') metadata[key] = (value as string | null) ?? null;
        else if (key === 'colorMode') metadata.colorMode = (value as 'light' | 'dark' | null) ?? null;
      }
      const priorStyle = storyUpdateParts(file.source)?.authorCss ?? null;
      const derived = await derive(file, source, metadata, assets, { css: update.effects.css, priorStyle: (style) => style === priorStyle });
      const entry: ArtifactFileEdit = { at: now(), by: author(), summary: editSummary(graph, next, update, metadata.title) };
      graph = next;
      version += 1;
      editId = `offline-${version}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
      change({ ...file, source, metadata, ...derived, journal: [...file.journal, entry] });
      return {
        ok: true,
        status: 200,
        body: {
          document: structuredClone(graph), markup: source, edit_id: editId, version,
          title: metadata.title, theme: metadata.theme, template: metadata.template, colorMode: metadata.colorMode,
        },
      };
    },

    async prepare(source): Promise<DocumentResourcePreparation> {
      if (!needsAuthoringContext(source)) return {};
      const have = authoringInputs(file.source);
      for (const id of Object.keys(file.island.refData ?? {})) have.add(`ref:ref:${id}`);
      for (const input of authoringInputs(source)) if (!have.has(input)) throw new Error(OFFLINE_ASSET_REASON);
      return {};
    },

    async previewCss(markup) {
      const css = await compileStoryCss(markup, { force: true });
      if (typeof css !== 'string') throw new BackendRequestError('no stylesheet', 422);
      return { css };
    },

    async previewQueries(markup) {
      const flow = declarationsOf(markup);
      if (!flow) return null;
      const unran = unranQueries(flow, ranFlow);
      const out: Pick<DataflowState, 'tables' | 'errors'> = { tables: {}, errors: {} };
      for (const query of flow.queries) {
        const table = file.snapshot.state.tables[query.name];
        const error = file.snapshot.state.errors[query.name];
        if (unran.has(query.name)) out.errors[query.name] = OFFLINE_QUERY_REASON;
        else if (table) out.tables[query.name] = table;
        else if (error !== undefined) out.errors[query.name] = error;
      }
      return { ...out, flow: file.island.dataflow?.flow ?? null };
    },

    queryTable: () => refuse('runQueries'),
    importImage: () => refuse('webAssets'),
    versions: () => refuse('versions'),
    version: () => refuse('versions'),
    revert: () => refuse('versions'),
    live: () => () => {},
    liveFrame: async () => null,

    /** The snapshot over the declarations as they are NOW; a query the download never ran says so. */
    queryTransport() {
      const current = (): { transport: QueryTransport; unran: Set<string> } => {
        const flow = currentFlow();
        return { transport: createSnapshotTransport(flow, file.snapshot), unran: unranQueries(declarationsOf(file.source) ?? EMPTY_DATAFLOW, ranFlow) };
      };
      return {
        async run(values, only) {
          const { transport, unran } = current();
          const answered = await transport.run(values, only.filter((name) => !unran.has(name)));
          for (const name of only) if (unran.has(name)) answered.errors[name] = OFFLINE_QUERY_REASON;
          return answered;
        },
        async page(values, name, page) {
          const { transport, unran } = current();
          if (unran.has(name)) throw new Error(OFFLINE_QUERY_REASON);
          return transport.page!(values, name, page);
        },
        /** What the file's own engine runs over: every row of each import the downloader could hold. */
        async hold(name) {
          const tables = file.snapshot.held?.[name];
          if (!tables) throw new Error(OFFLINE_QUERY_REASON);
          return tables;
        },
        dispose() {},
      };
    },

    // ── comments ──────────────────────────────────────────────────────────
    /** Omitted status reads the OPEN threads, as GET /annotations does (the server's default). */
    async listAnnotations(status = 'open') {
      return threadsNow().filter((thread) => thread.status === status);
    },

    async createAnnotation(body, idempotencyKey) {
      const again = created.get(idempotencyKey);
      if (again) return findThread(again);
      const nodeId = typeof body.node_id === 'string' ? body.node_id : null;
      const found = nodeId ? anchorIndex(file.source).get(nodeId) : undefined;
      const text = typeof body.body === 'string' ? body.body : '';
      if (!found || !nodeId) throw new BackendRequestError('bad_path: That part of the document is no longer here.', 400);
      if (!text.trim()) throw new BackendRequestError('invalid_annotation: A comment needs some words.', 400);
      const id = localId();
      const at = now();
      const quote = typeof body.quote === 'string' ? canonicalQuote(body.quote) || null : null;
      const comment: AnnotationCommentWire = { id, body: text, author: { kind: 'human', label: author(), transport: 'browser', user_id: null, image: null }, created_at: at };
      const thread: AnnotationWire = {
        id, status: 'open', anchor: null, orphaned: false, anchor_version: version,
        snippet: snippetOf(file.source.slice(found.node.start, found.node.end)),
        quote, range: (body.range as AnnotationWire['range']) ?? null, quote_found: null,
        thread: [comment], created_at: at, resolved_at: null,
      };
      created.set(idempotencyKey, id);
      const anchor = { key: nodeId, nodeId, path: sourcePathToBodyPath(file.source, found.path) ?? found.path, spanStart: found.node.start, spanEnd: found.node.end };
      saveThreads([...file.threads, anchoredThread({ ...thread, anchor }, file.source, anchorIndex(file.source))], [...file.localIds, id]);
      return findThread(id);
    },

    async actOnAnnotation(annotationId, action) {
      const thread = file.threads.find((t) => t.id === annotationId);
      if (!thread) throw new BackendRequestError('That comment is no longer in this file.', 404);
      const at = now();
      let next: AnnotationWire = { ...thread };
      let localIds = file.localIds;
      if (typeof action.reply === 'string' && action.reply.trim()) {
        const id = localId();
        next.thread = [...thread.thread, { id, body: action.reply, author: { kind: 'human', label: author(), transport: 'browser', user_id: null, image: null }, created_at: at }];
        localIds = [...localIds, id];
      }
      if (action.resolve) next = { ...next, status: 'resolved', resolved_at: at };
      if (action.reopen) next = { ...next, status: 'open', resolved_at: null };
      saveThreads(file.threads.map((t) => (t.id === annotationId ? next : t)), localIds);
      return findThread(annotationId);
    },

    async deleteAnnotation(annotationId) {
      if (!file.localIds.includes(annotationId)) throw new BackendRequestError(LOCAL_DELETE_ONLY, 403);
      const root = file.threads.find((t) => t.id === annotationId);
      if (root) {
        const gone = new Set(root.thread.map((c) => c.id));
        saveThreads(file.threads.filter((t) => t.id !== annotationId), file.localIds.filter((id) => !gone.has(id)));
        return;
      }
      saveThreads(
        file.threads.map((t) => ({ ...t, thread: t.thread.filter((c) => c.id !== annotationId) })),
        file.localIds.filter((id) => id !== annotationId),
      );
    },

    uploadCommentImage: () => refuse('commentImages'),
    async members(query) { return query === undefined ? { mentions: {} } : { people: [] }; },
    remoteSessions: () => refuse('remoteSessions'),
    deleteRemoteSession: () => refuse('remoteSessions'),
  };
}
