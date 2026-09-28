/**
 * SERVING THE COMPILED PAGE (docs/phase2-architecture.md §2.2, §5.2, §6, §10).
 *
 * The one function every reader route calls once it has admitted the request
 * (`/a/:id/raw`, the app page `/a/:id` and the profile address, a domain post,
 * an export capture): the version's stored compile, this request's overlay,
 * and — for a guest-readable head — the guest snapshot, assembled into the
 * whole HTML document by the one assembler. It returns data, never a
 * `Response`; the route translates it (and falls back to today's renderer when
 * it says so).
 *
 * THE STEPS, each of which may end in a fallback that names its reason:
 *  1. The stored compile. None → `not-compiled`. A recorded failure of THIS
 *     build → its own reason (`compile-error`, `unported`). A compile (or a
 *     failure) from another build, or made when no island build could be read
 *     (`build: 'none'`) → recompile inline under COMPILE_INLINE_BUDGET_MS; over
 *     it → `over-budget` (the detached compile still writes back, so the next
 *     read is a hit), a failed recompile → its reason. A version's author script
 *     is served by the compiled page (the lazy author host, lib/islands/author-host);
 *     a compile that does not carry it → `unported`: a page must be whole.
 *  2. The data. Only the head of a document a guest may read has a guest
 *     snapshot (an archived version is its editors' alone). A FRESH snapshot
 *     (marks equal, young) is served. A stale one younger than
 *     SNAPSHOT_MAX_AGE_MS is served with a revalidation queued — but only
 *     while the plan the anonymous reader's CURRENT access derives is the one
 *     it was keyed on: a dataset that just went private moves the plan, and its
 *     rows must never reach a reader from shared state. Anything else runs the
 *     cold path: the snapshot's own anonymous revalidation, waited for within
 *     SERVED_RESULTS_BUDGET_MS (exactly served-results.server's budget; the late
 *     run keeps going and stores its snapshot), else the page carries
 *     declarations without rows and fetches its own, as today.
 *  3. The story. With a snapshot (or URL `$` values, or stored drawings) the
 *     compiled page's SSR module renders the islands WITH them — cached per
 *     (build, snapshot, values, drawings), never keyed on rows; with none, the
 *     stored `compiled.html` is the story verbatim. A capture renders from its
 *     own settled run and is never cached.
 *  4. The assembler, with the request's live identity and a domain post's
 *     footer as its inputs.
 *
 * Any other throw is a `compile-error` fallback: a reader never gets a 500
 * because the compiled path failed.
 */
import { parseFragment } from 'parse5';
import { createHash } from 'node:crypto';
import type { ArtifactRow } from '@/lib/artifacts';
import type { ArchivedRender } from '@/lib/archived-version';
import { mermaidImagesFor } from '@/lib/mermaid-images/store';
import type { ServedResults, StoredMermaidImage } from '@/lib/story-runtime/contract';
import type { Scalar } from '@/lib/story/dataflow';
import type { ReaderChromeInput } from '@/lib/story/reader-chrome';
import { recompilePage, type PreparedPage } from '@/lib/story/prepared-page.server';
import { SERVED_RESULTS_BUDGET_MS, tokenOf } from '@/lib/story/served-results.server';
import { readUrlValues } from '@/lib/story/url-values';
import { escapeHtml } from '@/lib/story/reader-chrome';
import { DOMAIN_FOOTER_CSS, DOMAIN_FOOTER_TEXT } from '@/lib/story/document-styles';
import { assembleReaderPage } from './assembler';
import { loadCompilerBuild } from './build.server';
import {
  COMPILE_INLINE_BUDGET_MS, isCompileFailure, SNAPSHOT_MAX_AGE_MS,
  type AssembleHead, type AssembleInput, type AssembleOverlay, type CompiledPage, type CompilerBuild, type DataSnapshot,
  type ReaderFallbackReason, type SnapshotKey, type StoredCompile,
} from './contract';
import { planOf } from './plan';
import { anonymousAccessFacts, snapshotKeyFor, snapshotStore } from './snapshots.server';

/** What one admitted request decides about its compiled render. Nothing here is stored. */
export interface CompiledReaderRequest {
  /** The archived version this read renders, or null for the head. */
  at: ArchivedRender | null;
  /** The request's query string: the reader's `$` values. */
  search: string;
  /** Which of the version's stored Mermaid drawings this surface shows (lib/mermaid-images), or none (`?mermaid=engine`, a domain post). */
  drawings: 'document' | 'inline' | null;
  /** A capture's colour (`color=` under a verified export key); a reader gets the version's. */
  colorMode?: 'light' | 'dark' | null;
  /** The signed-in hint (a session), never the identity. */
  signedIn: boolean;
  /** Where the page queries, writes and fetches its overlay; null on a capture. */
  doors: AssembleOverlay['doors'];
  /** An archived render's read-only reason. */
  readOnly?: string | null;
  /** The document's live identity (`<body data-mx-live-id data-mx-live-edit>`); null on a capture or an archived render. */
  live: { id: string; editId: string } | null;
  /** Server-rendered reader chrome (the app page), or null (`/raw`, captures, a domain post). */
  chrome: ReaderChromeInput | null;
  /** Extra first-screen font files the chrome paints with (lib/story/first-screen-fonts readerChromeFonts). */
  chromeFonts?: readonly string[];
  spa: AssembleInput['spa'];
  head: AssembleHead | null;
  /**
   * A CAPTURE's own settled run (the exporter photographs this page): its answers instead of the guest
   * snapshot, rendered into the story and never cached — they were computed for whoever asked.
   */
  results?: ServedResults | null;
  /** A domain post's attribution line (lib/story/document's bare footer), after the story. */
  footer?: { html: string; css: string } | null;
  /** A document served by itself: today's standalone stylesheets, byte for byte (AssembleInput.sheets). */
  sheets?: AssembleInput['sheets'];
  /** Behaviour chunks this path adds to the version's own (`page`: the compiled /raw page's behaviour, lib/islands/page). */
  behaviors?: readonly string[];
  /**
   * `false`: the document without its own chrome — a deck's slide rail and present bar and their
   * behaviour (`@mx/deck`) — as today's renderer draws `/raw?chrome=0` (StoryRuntimeApp `chrome`).
   * Default true.
   */
  documentChrome?: boolean;
}

export type CompiledReaderAnswer =
  | { mode: 'compiled'; html: string; headers: Readonly<Record<string, string>> }
  | { mode: 'legacy'; fallback: ReaderFallbackReason };

const fallback = (reason: ReaderFallbackReason): CompiledReaderAnswer => ({ mode: 'legacy', fallback: reason });

/** A stored compile this deployment can serve, or the reason it cannot. */
type Usable = { page: CompiledPage } | { reason: ReaderFallbackReason };

const logged = new Set<string>();
/** A recorded failure is logged once per version and reason, not once per read (spec §6). */
function logOnce(row: ArtifactRow, reason: ReaderFallbackReason, detail: string): void {
  const key = `${row.id}:${row.version}:${reason}`;
  if (logged.has(key)) return;
  if (logged.size > 4096) logged.clear();
  logged.add(key);
  console.warn(`[compiled-page] ${row.id} v${row.version} served by today's renderer (${reason}): ${detail}`);
}

const usableOf = (stored: StoredCompile): Usable => (isCompileFailure(stored) ? { reason: stored.reason } : { page: stored });

/** Step 1: the stored compile, recompiled inline when it is from another build. */
async function compiledOf(row: ArtifactRow, page: PreparedPage, at: ArchivedRender | null, build: CompilerBuild): Promise<Usable> {
  const stored = page.compiled;
  if (!stored) return { reason: 'not-compiled' };
  if (stored.build === build.id) {
    if (isCompileFailure(stored)) logOnce(row, stored.reason, stored.error);
    return usableOf(stored);
  }
  // Deploy lag or a compile made without an island build: this build's compile, within the budget.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), COMPILE_INLINE_BUDGET_MS); });
  const compile = recompilePage(row, at, page);
  // The race's loser must never surface as an unhandled rejection; the write-back is recompilePage's own.
  void compile.catch(() => {});
  try {
    const recompiled = await Promise.race([compile, late]);
    if (recompiled === 'late') return { reason: 'over-budget' };
    if (!recompiled) return { reason: 'build-mismatch' };
    if (recompiled.build !== build.id) return { reason: 'build-mismatch' };
    if (isCompileFailure(recompiled)) logOnce(row, recompiled.reason, recompiled.error);
    return usableOf(recompiled);
  } finally {
    clearTimeout(timer);
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Step 2: the guest snapshot
 * ────────────────────────────────────────────────────────────────────────── */

const keyString = (key: SnapshotKey): string => `${key.artifactId}\u0000${key.slot}\u0000${key.planKey}\u0000${key.inputsKey}`;

/** One revalidation per key in this process: concurrent readers of a stale or missing snapshot share it. */
const inflight = new Map<string, Promise<DataSnapshot | null>>();
function revalidation(key: SnapshotKey, recipe: { plan: NonNullable<CompiledPage['plan']>; values: Record<string, Scalar>; build: string }): Promise<DataSnapshot | null> {
  const k = keyString(key);
  let running = inflight.get(k);
  if (!running) {
    running = snapshotStore.revalidate(key, recipe).catch((error: unknown) => {
      console.warn('[compiled-page] snapshot revalidation failed', key.artifactId, error);
      return null;
    }).finally(() => inflight.delete(k));
    inflight.set(k, running);
  }
  return running;
}

/** `promise`'s answer within `ms`, else null; the promise itself keeps running. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The guest snapshot this request may be served, or null. Only for the head of a document a guest
 * may read: a private document has no guest snapshot and never runs the anonymous cold path.
 */
async function snapshotFor(row: ArtifactRow, compiled: CompiledPage, flow: NonNullable<PreparedPage['declared']>['flow'], values: Record<string, Scalar>): Promise<DataSnapshot | null> {
  const plan = compiled.plan;
  if (!plan || !plan.queries.some((q) => q.scope === 'shared') || row.visibility === 'private') return null;
  const key = snapshotKeyFor(row.id, 'head', plan, values);
  const recipe = { plan, values, build: compiled.build };
  const read = await snapshotStore.get(key);
  if (read?.fresh) return read.snapshot;
  if (read && Date.now() - read.snapshot.computedAt <= SNAPSHOT_MAX_AGE_MS) {
    // Stale but young: still the guest's answer only while the guest's access derives the same plan.
    const current = planOf(flow, await anonymousAccessFacts(row, flow));
    if (snapshotKeyFor(row.id, 'head', current, values).planKey === key.planKey) {
      void revalidation(key, recipe);
      return read.snapshot;
    }
    return null;
  }
  // Missing or too old: the cold path, within the served-results budget.
  return within(revalidation(key, recipe), SERVED_RESULTS_BUDGET_MS);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Step 3: the story
 * ────────────────────────────────────────────────────────────────────────── */

const RENDERS_KEPT = 256;
const renders = new Map<string, string>();
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
/** Sorted keys: the same values are the same digest whatever order the URL named them in. */
const sorted = (record: Readonly<Record<string, unknown>>): Array<[string, unknown]> => Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

interface StoryInput {
  values: Record<string, Scalar>;
  results: ServedResults | null;
  mermaidImages: Readonly<Record<string, StoredMermaidImage>>;
  drawings: DataSnapshot['drawings'];
  /** What identifies the results without hashing them: the snapshot's key and time; null for a capture's run (not cached). */
  resultsId: string | null;
}

async function storyOf(compiled: CompiledPage, input: StoryInput): Promise<string> {
  const plain = !input.results && !Object.keys(input.values).length && !Object.keys(input.mermaidImages).length;
  if (!compiled.ssr || plain) return compiled.html;
  const cacheKey = input.resultsId === null && input.results ? null
    : `${compiled.build}:${compiled.ssr.sha}:${input.resultsId ?? '-'}:${digest(sorted(input.values))}:${digest(sorted(input.mermaidImages))}`;
  const cached = cacheKey ? renders.get(cacheKey) : undefined;
  if (cached !== undefined) {
    renders.delete(cacheKey!);
    renders.set(cacheKey!, cached);
    return cached;
  }
  // Loaded on the first compiled read, not at the top: the SSR loader carries Babel and Solid's
  // server build, which a process serving today's renderer (`FLAG__COMPILED_READER=off`) never needs
  // (the same boundary prepared-page.server keeps for the compiler).
  const { loadSsrModule } = await import('./bundle.server');
  const module = await loadSsrModule(compiled.ssr);
  const html = module.render({ values: input.values, results: input.results, mermaidImages: input.mermaidImages, drawings: input.drawings });
  if (cacheKey) {
    renders.set(cacheKey, html);
    while (renders.size > RENDERS_KEPT) renders.delete(renders.keys().next().value!);
  }
  return html;
}

/**
 * The story without a deck's own chrome: the compiler wraps a deck's column as
 * `<div class="mx-deck"><nav class="mx-rail">…</nav><div class="mx-doc">…</div><div class="mx-present">…</div></div>`;
 * this keeps the column exactly as served (sliced by the parser's source offsets, never re-serialised) and
 * drops the rest. A story that is not a deck comes back as it is.
 */
export function withoutDeckChrome(story: string): string {
  const fragment = parseFragment(story, { sourceCodeLocationInfo: true }) as unknown as { childNodes: Located[] };
  const deck = fragment.childNodes.find((n) => n.tagName === 'div' && classOf(n) === 'mx-deck');
  const column = deck?.childNodes?.find((n) => n.tagName === 'div' && classOf(n) === 'mx-doc');
  const [whole, kept] = [deck?.sourceCodeLocation, column?.sourceCodeLocation];
  if (!whole || !kept) return story;
  return story.slice(0, whole.startOffset) + story.slice(kept.startOffset, kept.endOffset) + story.slice(whole.endOffset);
}
interface Located { tagName?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: Located[]; sourceCodeLocation?: { startOffset: number; endOffset: number } }
const classOf = (node: Located): string | undefined => node.attrs?.find((a) => a.name === 'class')?.value;
/** The deck's framework-free behaviour chunk (the compiler's `DECK_BEHAVIOR`). */
const DECK_BEHAVIOR = '@mx/deck';

/** A DOMAIN POST's one line of attribution (its style: lib/story/document-styles DOMAIN_FOOTER_CSS). */
export const domainFooter = (href: string): { html: string; css: string } => ({
  html: `<footer data-mx-domain-footer="">${DOMAIN_FOOTER_TEXT} <a href="${escapeHtml(href)}" rel="noopener">artifactbin</a></footer>`,
  css: DOMAIN_FOOTER_CSS,
});

/**
 * THE COMPILED PAGE for one admitted request over one prepared version, or the reason this request
 * is served by today's renderer instead.
 */
export async function compiledPageFor(row: ArtifactRow, page: PreparedPage, reader: CompiledReaderRequest): Promise<CompiledReaderAnswer> {
  try {
    let build: CompilerBuild;
    try {
      build = loadCompilerBuild();
    } catch (error) {
      logOnce(row, 'build-mismatch', error instanceof Error ? error.message : String(error));
      return fallback('build-mismatch');
    }
    const usable = await compiledOf(row, page, reader.at, build);
    if ('reason' in usable) return fallback(usable.reason);
    const compiled = usable.page;
    // The author's script runs from the compiled page's data (boot's lazy author host). A compile that
    // does not carry this version's script would serve the page without it: a page must be whole.
    if ((page.authorScript || null) !== (compiled.authorScript || null)) {
      logOnce(row, 'unported', 'the stored compile does not carry the version\'s author script');
      return fallback('unported');
    }

    const flow = page.declared?.flow ?? null;
    const values = flow ? readUrlValues(reader.search, flow) : {};
    const [mermaidImages, snapshot] = await Promise.all([
      reader.drawings
        ? mermaidImagesFor({ artifactId: row.id, version: reader.at?.version ?? row.version, surface: reader.drawings, head: !reader.at, visibility: row.visibility }, page.data.nodes)
        : Promise.resolve({}),
      // A capture brings its own settled run; an archived version and a version that cannot run have no snapshot.
      reader.results !== undefined || reader.at || !flow || page.declared?.state ? Promise.resolve(null) : snapshotFor(row, compiled, flow, values),
    ]);
    // The live stream picks up from the snapshot's marks (served-results.server `since`): a write between
    // the snapshot and the page's stream reaches the page as the ordinary `data` frame.
    const served: DataSnapshot | null = snapshot
      ? { ...snapshot, results: { ...snapshot.results, ...(Object.keys(snapshot.marks).length ? { since: tokenOf(new Map(Object.entries(snapshot.marks))) } : {}) } }
      : null;
    const results = reader.results ?? served?.results ?? null;
    const story = await storyOf(compiled, {
      values, results, mermaidImages, drawings: served?.drawings ?? {},
      resultsId: served ? `${keyString(served.key)}:${served.computedAt}` : null,
    });

    const colorMode = reader.colorMode ?? page.data.colorMode;
    const bare = reader.documentChrome === false;
    const behaviors = [...new Set([...(reader.behaviors ?? []), ...compiled.behaviors])].filter((b) => !(bare && b === DECK_BEHAVIOR));
    const assembled = assembleReaderPage({
      compiled: { ...compiled, behaviors },
      story: bare ? withoutDeckChrome(story) : story,
      css: page.css,
      fontPreloads: [...page.fontPreloads, ...(reader.chromeFonts ?? [])],
      title: page.title,
      theme: page.theme,
      colorMode,
      // A capture's answers ride as the snapshot the page starts from: the islands then ask for nothing.
      snapshot: reader.results ? { ...(served ?? emptySnapshot(row)), results: reader.results } : served,
      overlay: { values, mermaidImages, signedIn: reader.signedIn, doors: doorsFor(compiled, reader.doors), readOnly: reader.readOnly ?? null },
      chrome: reader.chrome,
      spa: reader.spa,
      build,
      head: reader.head,
      live: reader.live,
      footer: reader.footer ?? null,
      sheets: reader.sheets ?? null,
    });
    return { mode: 'compiled', html: assembled.html, headers: assembled.headers };
  } catch (error) {
    // `IslandSsrUnavailable` (the shared build has no server half for a kit module) and every other
    // failure of this path: today's renderer answers, never a 500.
    logOnce(row, 'compile-error', error instanceof Error ? error.message : String(error));
    return fallback('compile-error');
  }
}

/**
 * The page's doors as the compiled page uses them: the viewer overlay's only when the version's plan
 * has a viewer-scope query, so the page never asks a door the server has nothing to answer on.
 */
function doorsFor(compiled: CompiledPage, doors: CompiledReaderRequest['doors']): CompiledReaderRequest['doors'] {
  if (!doors?.viewerUrl || compiled.plan?.queries.some((q) => q.scope === 'viewer')) return doors;
  const { viewerUrl: _unused, ...rest } = doors;
  return rest;
}

/** The snapshot shell a capture's own run rides in (never stored). */
const emptySnapshot = (row: ArtifactRow): DataSnapshot => ({
  key: { artifactId: row.id, slot: 'head', planKey: '', inputsKey: '' },
  marks: {}, results: { tables: {}, errors: {} }, drawings: {}, computedAt: 0, build: '',
});
