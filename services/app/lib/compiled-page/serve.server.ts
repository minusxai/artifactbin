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
 *  1. The stored compile, independent of the current deployment. None, or a
 *     hand-raised compatibility minimum → compile inline and wait. A recorded
 *     failure keeps its reason (`compile-error`, `unported`). A version's author script
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
 *
 * THE FALLBACK CONTRACT (spec §6) is one switch, `fallbackPolicy()`:
 *  - `legacy` (today): every reason above answers `{ mode: 'legacy' }` and the
 *    route serves today's renderer for this request.
 *  - `compiled-only` (once Wave 4 deletes today's reader; w4-flip-docs removes
 *    the switch and the `legacy` branch): a missing or incompatible compile
 *    compiles inline and WAITs (one compile per version shared by concurrent
 *    readers); `over-budget` is gone — the budget only decides whether the
 *    inline compile is logged as slow; `compile-error` (and any reason still
 *    left after the wait) answers `{ mode: 'failed', status: 500 }`, reported
 *    on every occurrence (`console.error` and `compiledPageFailures()`), and it
 *    must stay at zero; `unported` is never reached — every registered
 *    component has a compile path (compiler-coverage.test.ts asserts it).
 */
import { parseFragment } from 'parse5';
import { createHash } from 'node:crypto';
import { holdableImports, type ArtifactRow, type RoleActor } from '@/lib/artifacts';
import type { ArchivedRender } from '@/lib/archived-version';
import { mermaidImagesFor } from '@/lib/mermaid-images/store';
import type { ServedResults, StoredMermaidImage } from '@/lib/story-runtime/contract';
import type { Scalar } from '@/lib/story/dataflow';
import type { ReaderChromeInput } from '@/lib/story/reader-chrome';
import { recompilePage, type PreparedPage } from '@/lib/story/prepared-page.server';
import { SERVED_RESULTS_BUDGET_MS, tokenOf } from '@/lib/story/served-results.server';
import { readUrlValues } from '@/lib/story/url-values';
import { escapeHtml } from '@artifactbin/utils/escape';
import { DOMAIN_FOOTER_CSS, DOMAIN_FOOTER_TEXT } from '@/lib/story/document-styles';
import { assembleReaderPage } from './assembler';
import { loadCompilerBuild } from './build.server';
import { unresolvedSpecifiers } from './runtime-binding';
import { retainedBuild } from './shared-builds.server';

import {
  COMPILE_INLINE_BUDGET_MS, isCompileFailure, SNAPSHOT_MAX_AGE_MS,
  MIN_PAGE_FORMAT, MIN_HANDOVER_CONTRACT,
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
  /** The managed `<Iframe>`'s asset door (AssembleOverlay.managedAssets), or none without an asset origin. */
  managedAssets?: AssembleOverlay['managedAssets'];
  /**
   * The reader whose holdings the page's own SQLite engine answers for (lib/artifacts holdableImports,
   * IslandPageData.hold): the one the page's query door answers — the app page's request actor, `/raw`'s
   * anonymous reader (`null`), as today's reader decides it. Absent: the page holds nothing.
   */
  holder?: RoleActor | null;
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
  /** Export captures use full-size image bytes and no responsive srcset. */
  capture?: boolean;
  /** A capture's verified image import door without opening a query door. */
  assetsUrl?: string;
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
  | { mode: 'legacy'; fallback: ReaderFallbackReason }
  /** `compiled-only`: the compiled page could not be made; the route answers 500 (there is no other renderer). */
  | { mode: 'failed'; reason: ReaderFallbackReason; status: 500 };

const fallback = (reason: ReaderFallbackReason): CompiledReaderAnswer => ({ mode: 'legacy', fallback: reason });

/* ──────────────────────────────────────────────────────────────────────────
 * The fallback contract (spec §6)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * What a read does when the stored compile cannot be served as it is. `legacy`: today's renderer
 * answers the request. `compiled-only`: the read compiles inline and waits, and a compile that still
 * fails is a 500 — the contract once today's reader is deleted.
 */
export type FallbackPolicy = 'legacy' | 'compiled-only';
let policyOverride: FallbackPolicy | null = null;
/** A test's override for its file; the product never calls it. */
export function setFallbackPolicyForTests(policy: FallbackPolicy | null): void { policyOverride = policy; }
/**
 * THE SWITCH. `legacy` until Wave 4 deletes today's reader; w4-flip-docs removes this function, its
 * override and every `legacy` branch below, leaving `compiled-only` as the only behaviour.
 */
export function fallbackPolicy(): FallbackPolicy { return policyOverride ?? 'compiled-only'; }

/** Thrown by a page that has no other way to answer a `failed` read (lib/artifact-page): the server answers 500. */
export class CompiledPageFailed extends Error {
  constructor(readonly artifactId: string, readonly reason: ReaderFallbackReason) {
    super(`compiled page ${artifactId} could not be rendered (${reason})`);
    this.name = 'CompiledPageFailed';
  }
}

let failures = 0;
/** How many reads this process answered 500 because the compiled page could not be made (it must stay at zero). */
export const compiledPageFailures = (): number => failures;
/** A failed compiled read: reported on EVERY occurrence, never once per version — it is an incident, not a known state. */
function failed(row: ArtifactRow, reason: ReaderFallbackReason, detail: string): CompiledReaderAnswer {
  failures += 1;
  console.error(`[compiled-page] FAILED ${row.id} v${row.version} (${reason}): ${detail}`);
  return { mode: 'failed', reason, status: 500 };
}

/**
 * A stored compile this deployment can serve, or the reason it cannot. `pinned`: the build the page must
 * run against instead of the live one (its own, retained) while its background recompile runs.
 */
type Usable = { page: CompiledPage; pinned?: CompilerBuild } | { reason: ReaderFallbackReason };

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

/** Inline compiles in flight, by version and build: concurrent readers of one uncompiled version share one. */
const compiling = new Map<string, Promise<StoredCompile | null>>();

/**
 * `compiled-only`: this build's compile of the version, made now and WAITED for. The budget no longer
 * decides the answer, only whether the compile is logged as slow.
 */
async function compileAndWait(row: ArtifactRow, page: PreparedPage, at: ArchivedRender | null, build: CompilerBuild): Promise<Usable> {
  const key = `${row.id}\u0000${at ? `v:${at.version}` : 'head'}\u0000${row.version}\u0000${build.id}`;
  let running = compiling.get(key);
  if (!running) {
    const started = Date.now();
    running = recompilePage(row, at, page).finally(() => {
      compiling.delete(key);
      const ms = Date.now() - started;
      if (ms > COMPILE_INLINE_BUDGET_MS) console.warn(`[compiled-page] ${row.id} v${row.version} compiled inline in ${ms} ms (over the ${COMPILE_INLINE_BUDGET_MS} ms budget)`);
    });
    compiling.set(key, running);
  }
  const compiled = await running;
  if (!compiled || compiled.build !== build.id) return { reason: 'build-mismatch' };
  if (isCompileFailure(compiled)) logOnce(row, compiled.reason, compiled.error);
  return usableOf(compiled);
}

/**
 * Background recompiles of stored pages the live runtime cannot take (below the contract, or naming a
 * specifier the live build lacks) that are served pinned meanwhile. One at a time per process: a deploy
 * that raises the contract upgrades pages as they are read, never as a stampede of waited compiles.
 */
const UPGRADES_AT_ONCE = 1;
/** Queued at most: a crawl across every old page must not hold every page in memory; a dropped one queues again on its next read. */
const UPGRADES_QUEUED = 256;
const upgrades = new Map<string, () => Promise<unknown>>();
const upgrading = new Set<string>();
let upgradeRuns: Promise<void>[] = [];
function queueUpgrade(row: ArtifactRow, page: PreparedPage, at: ArchivedRender | null): void {
  const key = `${row.id}\u0000${at ? `v:${at.version}` : 'head'}\u0000${row.version}`;
  if (upgrades.has(key) || upgrading.has(key) || upgrades.size >= UPGRADES_QUEUED) return;
  upgrades.set(key, () => recompilePage(row, at, page));
  while (upgradeRuns.length < UPGRADES_AT_ONCE) {
    const run: Promise<void> = (async () => {
      for (let next = upgrades.entries().next(); !next.done; next = upgrades.entries().next()) {
        const [id, job] = next.value;
        upgrades.delete(id);
        upgrading.add(id);
        try { await job(); } catch (error) { console.warn('[compiled-page] background recompile failed', id, error); }
        finally { upgrading.delete(id); }
      }
    })().finally(() => { upgradeRuns = upgradeRuns.filter((r) => r !== run); });
    upgradeRuns.push(run);
  }
}
/** Wait for every queued background recompile (tests; a graceful shutdown). */
export async function drainCompiledUpgrades(): Promise<void> {
  while (upgradeRuns.length) await Promise.all(upgradeRuns);
}

/** The build a stored page was compiled against, while its chunks are retained: its own record, or the archived manifest. */
async function pinnedBuildOf(stored: CompiledPage): Promise<CompilerBuild | null> {
  const build = stored.sharedBuild ?? await retainedBuild(stored.build).catch(() => null);
  return build && !unresolvedSpecifiers(stored.module, build).length ? build : null;
}

/**
 * Step 1: one compile per document version. The shared runtime is bound live at serve time; a stored
 * page the live runtime cannot take (a raised contract, a specifier the live build lacks) keeps running
 * on the build it was compiled with while it recompiles in the background. Only a page with no such
 * build (or a raised page format) compiles inline and waits.
 */
async function compiledOf(row: ArtifactRow, page: PreparedPage, at: ArchivedRender | null, build: CompilerBuild, policy: FallbackPolicy): Promise<Usable> {
  const stored = page.compiled;
  if (stored && page.pageFormat >= MIN_PAGE_FORMAT) {
    if (isCompileFailure(stored)) {
      if (page.handoverContract >= MIN_HANDOVER_CONTRACT) { logOnce(row, stored.reason, stored.error); return usableOf(stored); }
    } else if (page.handoverContract >= MIN_HANDOVER_CONTRACT && !unresolvedSpecifiers(stored.module, build).length) {
      return { page: stored };
    } else {
      const pinned = await pinnedBuildOf(stored);
      if (pinned) {
        queueUpgrade(row, page, at);
        return { page: stored, pinned };
      }
    }
  }
  if (policy === 'compiled-only' || stored) return compileAndWait(row, page, at, build);
  return { reason: 'not-compiled' };
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
  state?: import('@/lib/story/dataflow').DataflowState;
  assetsUrl?: string;
  results: ServedResults | null;
  mermaidImages: Readonly<Record<string, StoredMermaidImage>>;
  drawings: DataSnapshot['drawings'];
  /** What identifies the results without hashing them: the snapshot's key and time; null for a capture's run (not cached). */
  resultsId: string | null;
  /**
   * The build whose SSR half renders the story: the one the page's browser module is bound to (the live
   * build, or a pinned page's own). Absent: this process's current half.
   */
  build?: CompilerBuild;
  /** The version's declared dataflow: a stored story re-rendered for a newer half starts, as its compile did, from the declared values. */
  flow?: NonNullable<PreparedPage['declared']>['flow'] | null;
}

/** The declared state: every scalar at its default — what the compile rendered `html` with (compiler declaredValues). */
const declaredValuesOf = (flow: StoryInput['flow']): Record<string, Scalar> =>
  Object.fromEntries((flow?.values ?? []).filter((v) => v.kind === 'scalar').map((v) => [v.name, (v as { default: Scalar }).default]));

export async function storyOf(compiled: CompiledPage, input: StoryInput): Promise<string> {
  const plain = !input.state && !input.assetsUrl && !input.results && !Object.keys(input.values).length && !Object.keys(input.mermaidImages).length;
  if (!compiled.ssr) return compiled.html;
  const half = input.build?.ssr;
  // The stored story is what the half that compiled it rendered. It is served as it is only while that is
  // the half the browser hydrates with: after a deploy that changed the kit it is rendered again, or the
  // server DOM and the client tree would disagree (a hydration mismatch, or a fix that never shows).
  const current = !half || compiled.build === input.build!.id || compiled.ssrHalf === half.url
    || (!!compiled.sharedBuild && compiled.sharedBuild.ssr?.url === half.url);
  if (plain && current) return compiled.html;
  const values = plain ? declaredValuesOf(input.flow) : input.values;
  const cacheKey = input.resultsId === null && input.results ? null
    : `${compiled.build}:${half?.url ?? '-'}:${compiled.ssr.sha}:${input.resultsId ?? '-'}:${digest(sorted(values))}:${digest(input.state ?? null)}:${digest(sorted(input.mermaidImages))}:${input.assetsUrl ?? ''}`;
  const cached = cacheKey ? renders.get(cacheKey) : undefined;
  if (cached !== undefined) {
    renders.delete(cacheKey!);
    renders.set(cacheKey!, cached);
    return cached;
  }
  // Loaded on the first compiled read, not at the top: the SSR loader carries Babel and Solid's
  // server build, which a process without a usable compiled page never needs
  // (the same boundary prepared-page.server keeps for the compiler).
  const { loadSsrModule } = await import('./bundle.server');
  const live = (() => { try { return loadCompilerBuild().ssr?.url; } catch { return undefined; } })();
  const module = await loadSsrModule(compiled.ssr, undefined, undefined, half && half.url !== live ? half : undefined);
  const rendered = module.render({ values, state: input.state, assetsUrl: input.assetsUrl, results: input.results, mermaidImages: input.mermaidImages, drawings: input.drawings });
  // The SSR module renders only the document tree. Its browser literals and large module data
  // are version-owned inert siblings stored with the first render; keep them for snapshot renders.
  const literalOpen = '<script type="application/json" data-mx-island-literals=';
  const dataOpen = '<script type="application/json" data-mx-module-data>';
  const literalAt = compiled.html.lastIndexOf(literalOpen);
  const dataAt = compiled.html.lastIndexOf(dataOpen);
  const carrierAt = literalAt < 0 ? dataAt : dataAt < 0 ? literalAt : Math.min(literalAt, dataAt);
  const html = compiled.islands[0]?.renderId === 'd-' && carrierAt >= 0 ? rendered + compiled.html.slice(carrierAt) : rendered;
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
  const policy = fallbackPolicy();
  // Today: today's renderer answers. Once it is deleted: a 500, reported (spec §6).
  const refuse = (reason: ReaderFallbackReason, detail: string): CompiledReaderAnswer => (policy === 'legacy' ? fallback(reason) : failed(row, reason, detail));
  try {
    let build: CompilerBuild;
    try {
      const stored = page.compiled;
      const compatible = page.pageFormat >= MIN_PAGE_FORMAT && page.handoverContract >= MIN_HANDOVER_CONTRACT;
      if (compatible && stored && isCompileFailure(stored)) {
        logOnce(row, stored.reason, stored.error);
        return refuse(stored.reason, stored.error);
      }
      build = loadCompilerBuild();
    } catch (error) {
      logOnce(row, 'build-mismatch', error instanceof Error ? error.message : String(error));
      return refuse('build-mismatch', error instanceof Error ? error.message : String(error));
    }
    let usable = await compiledOf(row, page, reader.at, build, policy);
    if ('reason' in usable) return refuse(usable.reason, 'the version has no compile this build can serve');
    // The author's script runs from the compiled page's data (boot's lazy author host). A compile that
    // does not carry this version's script would serve the page without it: a page must be whole.
    const carriesScript = (compiled: CompiledPage) => (page.authorScript || null) === (compiled.authorScript || null);
    const compiled = usable.page;
    // The runtime this page runs on: the live build, or — while it recompiles in the background — its own.
    if (usable.pinned) build = usable.pinned;
    if (!carriesScript(compiled)) {
      logOnce(row, 'unported', 'the stored compile does not carry the version\'s author script');
      return refuse('unported', 'the stored compile does not carry the version\'s author script');
    }

    const flow = page.declared?.flow ?? null;
    // Prepared state is useful for a version that cannot run. A healthy reader starts from defaults
    // and the guest snapshot, then lets its page engine take over; seeding `state` suppresses that run.
    const failedState = page.declared?.state && Object.keys(page.declared.state.errors).length ? page.declared.state : undefined;
    const values = flow ? readUrlValues(reader.search, flow) : {};
    const [mermaidImages, snapshot, hold] = await Promise.all([
      reader.drawings
        ? mermaidImagesFor({ artifactId: row.id, version: reader.at?.version ?? row.version, surface: reader.drawings, head: !reader.at, visibility: row.visibility }, page.data.nodes)
        : Promise.resolve({}),
      // A capture brings its own settled run; an archived version and a version that cannot run have no snapshot.
      reader.results !== undefined || reader.at || !flow || failedState ? Promise.resolve(null) : snapshotFor(row, compiled, flow, values),
      // What the page's engine may hold, for the door it queries through (today's reader asks on every render).
      flow && reader.doors && reader.holder !== undefined ? holdableImports(row, flow, reader.holder) : Promise.resolve([]),
    ]);
    // Local tables need the page engine even without a holdable import.
    const sqliteWasm = flow && reader.doors && (hold.length || flow.values.some((value) => value.kind === 'table'))
      ? build.sqliteWasm ?? null : null;
    // The live stream picks up from the snapshot's marks (served-results.server `since`): a write between
    // the snapshot and the page's stream reaches the page as the ordinary `data` frame.
    const served: DataSnapshot | null = snapshot
      ? { ...snapshot, results: { ...snapshot.results, ...(Object.keys(snapshot.marks).length ? { since: tokenOf(new Map(Object.entries(snapshot.marks))) } : {}) } }
      : null;
    const results = reader.results ?? served?.results ?? null;
    const story = await storyOf(compiled, {
      values, state: failedState, results, assetsUrl: reader.assetsUrl ?? reader.doors?.assetsUrl, mermaidImages, drawings: served?.drawings ?? {},
      resultsId: served ? `${keyString(served.key)}:${served.computedAt}` : null,
      build, flow,
    });

    const colorMode = reader.colorMode ?? page.data.colorMode;
    const bare = reader.documentChrome === false;
    const behaviors = [...new Set([...(reader.behaviors ?? []), ...compiled.behaviors])].filter((b) => !(bare && b === DECK_BEHAVIOR));
    const assembled = assembleReaderPage({
      compiled: { ...compiled, behaviors },
      capture: reader.capture,
      documentChrome: !bare,
      story: reader.capture
        ? (bare ? withoutDeckChrome(story) : story).replace(/<img\b[^>]*>/g, (tag) => tag.replace(/\s(?:srcSet|srcset|sizes)="[^"]*"/g, ''))
        : bare ? withoutDeckChrome(story) : story,
      css: page.css,
      fontPreloads: [...page.fontPreloads, ...(reader.chromeFonts ?? [])],
      title: page.title,
      theme: page.theme,
      colorMode,
      // A capture's answers ride as the snapshot the page starts from: the islands then ask for nothing.
      snapshot: reader.results ? { ...(served ?? emptySnapshot(row)), results: reader.results } : served,
      overlay: { values, state: failedState, mermaidImages, signedIn: reader.signedIn, doors: doorsFor(compiled, reader.doors), ...(reader.assetsUrl ? { assetsUrl: reader.assetsUrl } : {}), managedAssets: reader.managedAssets ?? null, readOnly: reader.readOnly ?? null, hold, sqliteWasm },
      chrome: reader.chrome,
      spa: compiled.handoverContract === MIN_HANDOVER_CONTRACT && !usable.pinned ? reader.spa : null,
      build,
      head: reader.head,
      live: reader.live,
      footer: reader.footer ?? null,
      sheets: reader.sheets ?? null,
    });
    return { mode: 'compiled', html: assembled.html, headers: assembled.headers };
  } catch (error) {
    // `IslandSsrUnavailable` (the shared build has no server half for a kit module) and every other
    // failure of this path: today's renderer answers while it exists, never a 500; after, a reported 500.
    const detail = error instanceof Error ? error.message : String(error);
    logOnce(row, 'compile-error', detail);
    return refuse('compile-error', detail);
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
