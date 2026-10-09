/**
 * THE PREPARED PAGE — each document version compiled for the reader ONCE.
 *
 * Serving a document used to parse its source, resolve glyphs and fonts,
 * rewrite ~140 KB of CSS with css-tree and render it on the server on EVERY
 * request. Everything in that work that belongs to the VERSION is done once
 * here and stored (app.prepared_pages):
 *
 *   - the isolated stylesheet (exactly what lib/compiled-page/styles/inline-css produces) and
 *     the node tree with the style values that policy rewrote (style-overrides);
 *   - glyphs, fonts, the resolved colour mode, the lazy-code manifest, the
 *     declared dataflow and the pinned compiled page.
 *
 * Nothing per viewer is stored. A request overlays what only it decides — who
 * reads, their `$` values, what they may hold, the other artifacts the document
 * embeds — through the same writer the whole preparation uses
 * (prepare-runtime.server `readerIslandData`). The compiled serve path renders
 * request data through the compiled page's pinned SSR module.
 *
 * A slot's key is only the document version. A deploy, compiler change, CSS
 * change or dependency change does not rebuild a published version. An invalid
 * cached HTML tree is repaired on its next read without editing that version. The
 * separate recorded columns let an operator select old versions for a
 * deliberate backfill. A version miss prepares, serves and writes back; the
 * write never fails the read.
 *
 * Produced at publish too (warmPreparedPage, after commit, off the write's
 * path) so the first reader of a new version is already a hit.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '@/lib/platform/db';
import type { ArtifactRow, Viewer } from '@/lib/artifacts';
import { declarationsForRow, holdableImports, refDataForRow, viewerIdentityFor } from '@/lib/artifacts/dataflow';
import { LIVE_ARTIFACT_SQL, type RoleActor } from '@/lib/artifacts/access';
import { artifactQuery } from '@/lib/artifacts/document';
import { savedMentionStates } from '@/lib/accounts/membership';
import { archivedReadOnly, servedRow, type ArchivedRender } from '@/lib/artifacts/archived-version';
import { currentStoryCss } from '@/lib/data/story/story-css.server';
import { preparedCssVersion } from './css-version.server';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { lookupWebAssets } from '../assets/web-assets';
import { collectExternalAssetUrls } from '../../document/external-images';
import { storedCompiledDataflow } from '@/lib/document/server';
import { prepareStoryParts, readerIslandData, type ReaderIslandInput } from './prepare-runtime.server';
import { inlineStoryCss, inlineStoryNodes } from '@/lib/compiled-page/styles/inline-css';
import { styleOverrides, type StyleOverride } from '@/lib/compiled-page/styles/style-overrides';
import { readerStorySheet } from './reader-sheet.server';
import { mermaidImagesFor } from '@/lib/mermaid-images/store';
import { inlineStoryElement } from '@/lib/compiled-page/story-element';
import { lazyCodeOf, type LazyCode } from '../../document/lazy-code';
import { assetsPath, mutatePath, queryPath } from '@/lib/compiled-page/styles/markup-csp';
import { readUrlValues } from '@/lib/dataflow/url-values';
import { servedResultsFor } from './served-results.server';
import type { StoryBaseCssRecipe } from '@/lib/compiled-page/styles/story-base-css';
import type { ServedStoryRuntime } from './prepared-runtime';
import type { StoryIslandData, StoryIslandDataflow } from '@/lib/story-runtime/contract';
import type { StoryDesignName } from '@/lib/validation/atlas-schemas';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { createSpeculationRulesStore } from '@/lib/compiled-page/modules.server';
import { archiveSharedBuild } from '@/lib/compiled-page/shared-builds.server';
import type { CompilerBuild, StoredCompile } from '@/lib/compiled-page/contract';
import { MIN_PAGE_FORMAT, MIN_HANDOVER_CONTRACT } from '@/lib/compiled-page/contract';
import { prepareWorkers } from './prepare-workers.server';
import { fixHtmlNesting } from '../../document/nesting';

/** Raise manually when older prepared pages cannot be read. */
const PAGE_FORMAT = MIN_PAGE_FORMAT;

/** One version, prepared for the reader. Nothing in it depends on who reads. */
export interface PreparedPage {
  pageFormat: number;
  handoverContract: number;
  data: Pick<StoryIslandData, 'nodes' | 'colorMode' | 'template' | 'chrome' | 'glyphs'>;
  css: string;
  overrides: StyleOverride[];
  base: StoryBaseCssRecipe;
  /** The raw authored `<style>`: the editor's door only (never the reader payload). */
  authorCss: string | null;
  authorScript: string | null;
  theme: StoryDesignName | null;
  title: string;
  fontPreloads: string[];
  lazyCode: LazyCode;
  /** The declared dataflow — declarations, or a version's answers when it cannot run. */
  declared: StoryIslandDataflow | null;
  /** What other rows this entry was built from; fingerprinted on every read. */
  deps: PreparedDeps;
  /** Older stored pages may carry a legacy render. New preparations omit it. */
  ssr?: { overlay: string; html: string } | null;
  /** The compiled page (lib/compiled-page), or its recorded failure. */
  compiled?: StoredCompile;
  /** The stylesheet version (css-version.server) `css` was prepared under: the row's `css_version`, set when read. */
  cssVersion?: string | null;
}
interface PreparedDeps { datasets: string[]; assets: string[] }

/** What a request (never the document) decides about its render. */
export interface ReaderContext {
  at: ArchivedRender | null;
  viewer: RoleActor | null;
  /** The page's query string — the reader's `$` values. */
  search: string;
  /**
   * `engine`: serve no stored diagram drawings (`?mermaid=engine`, what the
   * harvest itself loads). Otherwise the version's stored drawings for the
   * app's inline surface (lib/mermaid-images) are part of this overlay — per
   * REQUEST, not per version, because a harvest lands after the page was
   * prepared and the next read must carry it.
   */
  drawings?: 'stored' | 'engine';
  /** A CAPTURE's colour (`color=`, under a verified export key); a reader gets the version's. */
  colorMode?: 'light' | 'dark' | null;
  /**
   * Serve this request's first results (lib/story/prepared/served-results.server),
   * admitted as the page's query door admits this viewer. Absent: the page
   * fetches its own rows, as the stored anonymous render always does.
   */
  results?: { admit: Viewer };
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const buildAsset = (name: string): Buffer => readFileSync(path.join(process.cwd(), 'lib/build-assets', name));
const compilerFingerprint = (): string => buildAsset('prepared-sources.sha256').toString('utf8').trim();

const slotOf = (at: ArchivedRender | null): string => (at ? `v:${at.version}` : 'head');
/** The standalone reader is retired, so every prepared page needs a compile. */
function compilerBuild(): { build: CompilerBuild | null; error: string | null } | null {
  try {
    return { build: loadCompilerBuild(), error: null };
  } catch (error) {
    // No island build (never run, or unreadable): recorded as a failure, never a failed read.
    return { build: null, error: error instanceof Error ? error.message : String(error) };
  }
}
/** Only an edit changes a document's preparation identity. The slot is the other half of the key. */
const keyOf = (row: ArtifactRow): string => `v:${row.version}`;

/** Recorded provenance of other rows used by a new preparation; never invalidates a stored version. */
async function fingerprint(deps: PreparedDeps): Promise<string> {
  const parts: unknown[] = [];
  if (deps.datasets.length) {
    const db = await getDb();
    parts.push((await db.query('SELECT id, edit_id, sharing_revision, policy_revision, deleted_at IS NULL AS live FROM artifacts WHERE id = ANY($1::text[]) ORDER BY id', [deps.datasets])).rows);
  }
  if (deps.assets.length) {
    const held = await lookupWebAssets(deps.assets);
    parts.push([...held.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([url, r]) => [url, r.object_key, r.width, r.height, r.placeholder, r.small_object_key, r.small_width]));
  }
  return parts.length ? sha(JSON.stringify(parts)) : '';
}

/** The per-reader half of the island, through the one writer (readerIslandData). */
async function readerInputFor(row: ArtifactRow, page: Pick<PreparedPage, 'declared' | 'data'>, reader: ReaderContext): Promise<ReaderIslandInput & { colorMode?: 'light' | 'dark' }> {
  const { at, viewer, search } = reader;
  const declared = page.declared;
  const [refData, mentionStatuses, identity, hold, mermaidImages] = await Promise.all([
    refDataForRow(row), savedMentionStates(row), viewerIdentityFor(row, viewer?.userId ?? null),
    declared ? holdableImports(row, declared.flow, viewer) : Promise.resolve([]),
    reader.drawings === 'engine' ? Promise.resolve({}) : mermaidImagesFor({ artifactId: row.id, version: at?.version ?? row.version, surface: 'inline', head: !at, visibility: row.visibility }, page.data.nodes),
  ]);
  return {
    mermaidImages,
    ...(reader.colorMode ? { colorMode: reader.colorMode } : {}),
    refData, mentionStatuses, viewer: identity,
    dataflow: declared ? { ...declared, values: readUrlValues(search, declared.flow), hold } : null,
    queryUrl: queryPath(row.id), assetsUrl: assetsPath(row.id),
    ...(!at && declared?.flow.mutations?.length ? { mutateUrl: mutatePath(row.id) } : {}),
    // A snapshot render refuses every write by name, and carries no write door at all (above).
    ...(at ? { readOnly: archivedReadOnly(at.version) } : {}),
  };
}
type ReaderOverlay = ReaderIslandInput & { colorMode?: 'light' | 'dark' };

/**
 * The version compiled to static HTML and islands (lib/compiled-page/compiler), or the recorded
 * failure: a refused compile (`unported`) and a thrown one are stored, so a read never retries the
 * same build in a loop. The page's speculation rules are stored with it, so the header never names a
 * missing file.
 */
async function compiledFor(row: ArtifactRow, page: PreparedPage, refData: ReaderIslandInput['refData'], compiler: NonNullable<ReturnType<typeof compilerBuild>>): Promise<StoredCompile> {
  const build = compiler.build;
  if (!build) return { build: 'none', error: compiler.error ?? 'no island build', reason: 'compile-error' };
  try {
    await archiveSharedBuild(build);
    // Imported on first compile, not at the top: the compiler carries Babel, Solid and the static kit
    // (it renders static components at compile time), and this module sits under lib/artifacts,
    // which every tool that reads artifacts loads (the CLI's teaching build among them). A process
    // that does not prepare a page never loads any of it. The snapshot store
    // imports this module, so its access helper is reached the same way (no import cycle at load).
    const [{ compilePage }, { anonymousAccessFacts }] = await Promise.all([import('@/lib/compiled-page/compiler'), import('./snapshots.server')]);
    const flow = page.declared?.flow ?? null;
    const input = {
      nodes: page.data.nodes, colorMode: page.data.colorMode, template: page.data.template ?? null, chrome: page.data.chrome !== false,
      ...(page.data.glyphs ? { glyphs: page.data.glyphs } : {}),
      refData: refData ?? {}, flow, build: build.id, authorScript: page.authorScript,
      // The plan snapshots key on: the anonymous reader's admission, decided as the snapshot store decides it.
      ...(flow ? { access: await anonymousAccessFacts(row, flow) } : {}),
    };
    // The compile itself is CPU-bound (Babel, Solid, the static kit): on a prepare thread when this process has them.
    const threads = prepareWorkers();
    const compiled = threads ? await threads.compilePage(input, build) : await compilePage(input, build);
    if (compiled.unported.length) return { build: build.id, error: `unported: ${compiled.unported.join(', ')}`, reason: 'unported', unported: compiled.unported };
    await createSpeculationRulesStore().put(compiled.links);
    return compiled;
  } catch (error) {
    console.warn('[prepared-page] compile failed', error);
    return { build: build.id, error: error instanceof Error ? error.message : String(error), reason: 'compile-error' };
  }
}

/** Parse, isolate and render one version. The only place a served document is compiled. */
async function build(row: ArtifactRow, at: ArchivedRender | null, compiler: ReturnType<typeof compilerBuild>): Promise<PreparedPage> {
  const meta = (row.meta ?? {}) as { theme?: StoryDesignName | null; colorMode?: 'light' | 'dark' | null; template?: string | null; compiledCss?: string | null; cssCompileVersion?: string | null; refs?: Array<{ id: string; kind: string }> };
  const design = resolveStoredStoryDesign(meta.theme, meta.colorMode);
  const source = row.source ?? '';
  const assetUrls = collectExternalAssetUrls(source).all;
  const [compiledCss, held, declared] = await Promise.all([
    currentStoryCss(meta, row.source), lookupWebAssets(assetUrls), row.source ? declarationsForRow(row) : Promise.resolve(null),
  ]);
  const parts = await prepareStoryParts({
    source, compiledCss, theme: design.theme, colorMode: design.colorMode, title: row.title, template: meta.template ?? null,
    refData: {}, assetUrls: held,
  });
  const { runtime } = parts;
  const nodes = runtime.data.nodes;
  // The reader's copy of the sheet: only what this story can match (lib/story/prepared/reader-sheet.server).
  const sheet = { ...runtime, compiledCss: readerStorySheet(compiledCss, { source, nodes, theme: design.theme }) };
  const css = inlineStoryCss(sheet);
  const overrides = styleOverrides(nodes, inlineStoryNodes(nodes, sheet));
  // A document whose compiled data is stored with its source compiles against nothing else.
  const compiledElsewhere = !!row.source && !storedCompiledDataflow(row.meta, row.source);
  const datasets = compiledElsewhere
    ? [...new Set([...(declared?.flow.imports ?? []).map((i) => i.ref), ...(meta.refs ?? []).filter((r) => r.kind === 'dataset').map((r) => r.id)])].sort()
    : [];
  const page: PreparedPage = {
    pageFormat: PAGE_FORMAT, handoverContract: MIN_HANDOVER_CONTRACT,
    data: {
      nodes, colorMode: runtime.data.colorMode, template: runtime.data.template ?? null, chrome: runtime.data.chrome,
      ...(runtime.data.glyphs ? { glyphs: runtime.data.glyphs } : {}),
    },
    css, overrides, base: parts.baseRecipe, authorCss: runtime.authorCss, authorScript: runtime.authorScript,
    theme: runtime.theme, title: runtime.title, fontPreloads: runtime.fontPreloads ?? [],
    lazyCode: lazyCodeOf(nodes), declared: declared ?? null,
    deps: { datasets, assets: assetUrls },
  };
  // Only the version's compiled output is stored; request data is rendered by its pinned SSR module.
  const anonymous = await readerInputFor(row, page, { at, viewer: null, search: '' });
  if (compiler) page.compiled = await compiledFor(row, page, anonymous.refData, compiler);
  return page;
}

function servedOf(page: PreparedPage, input: ReaderOverlay): ServedStoryRuntime & { css: string } {
  return {
    data: { ...page.data, ...readerIslandData(input), ...(input.colorMode ? { colorMode: input.colorMode } : {}) } as StoryIslandData,
    css: page.css, overrides: page.overrides, base: page.base,
    authorScript: page.authorScript, theme: page.theme, title: page.title, fontPreloads: page.fontPreloads,
  };
}
const renderStory = (page: PreparedPage, input: ReaderOverlay): string => {
  const compiled = page.compiled;
  if (!compiled || !('html' in compiled)) throw new Error('prepared page has no compiled story');
  return inlineStoryElement(`<style>${page.css}</style>${compiled.html}`, input.colorMode ?? page.data.colorMode, page.theme);
};

interface StoredRow { page_key: string; deps: string; page: PreparedPage; page_format: number | null; handover_contract: number | null; css_version: string | null }

/** Write a fresh preparation back. `onlyKey`: only over the entry it replaces (a background re-preparation), never a newer one. */
async function store(row: ArtifactRow, slot: string, page: PreparedPage, onlyKey?: string): Promise<void> {
  try {
    const db = await getDb();
    const params = [row.id, slot, keyOf(row), await fingerprint(page.deps), JSON.stringify(page), compilerFingerprint(), page.compiled?.build ?? 'none', page.cssVersion ?? null, null, PAGE_FORMAT, MIN_HANDOVER_CONTRACT];
    if (onlyKey) {
      await db.query(
        `UPDATE prepared_pages SET deps = $4, page = $5::jsonb, compiler_version = $6, island_build = $7, css_version = $8, ssr_bundle = $9,
         page_format = $10, handover_contract = $11, updated_at = now() WHERE artifact_id = $1 AND slot = $2 AND page_key = $3`,
        params,
      );
      return;
    }
    await db.query(
      `INSERT INTO prepared_pages (artifact_id, slot, page_key, deps, page, compiler_version, island_build, css_version, ssr_bundle, page_format, handover_contract, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (artifact_id, slot) DO UPDATE SET page_key = EXCLUDED.page_key, deps = EXCLUDED.deps, page = EXCLUDED.page,
       compiler_version = EXCLUDED.compiler_version, island_build = EXCLUDED.island_build, css_version = EXCLUDED.css_version,
       ssr_bundle = EXCLUDED.ssr_bundle, page_format = EXCLUDED.page_format, handover_contract = EXCLUDED.handover_contract, updated_at = now()`,
      params,
    );
  } catch (error) {
    // A cache that cannot be written is a slower next read, never a failed one.
    console.warn('[prepared-page] write-back failed', row.id, slot, error);
  }
}

/** Prepare and compile one version now, under this deployment's stylesheet version. */
async function prepareNow(row: ArtifactRow, at: ArchivedRender | null): Promise<PreparedPage> {
  const page = await build(row, at, compilerBuild());
  page.cssVersion = preparedCssVersion();
  return page;
}

/**
 * Re-prepare a stored page whose stylesheet is older than this deployment's (css-version.server) and write it
 * over that same entry. The reader that found it was served the stored page; the backfill waits for this.
 */
export async function reprepareStoredPage(stored: ArtifactRow, at: ArchivedRender | null): Promise<{ row: ArtifactRow; page: PreparedPage }> {
  const row = await servedRow(stored, at);
  const page = await prepareNow(row, at);
  await store(row, slotOf(at), page, keyOf(row));
  return { row, page };
}

/** Background re-preparations of stale stylesheets: one at a time, at most RESTYLES_QUEUED waiting (a dropped one queues again on its next read). */
const RESTYLES_QUEUED = 256;
const restyles = new Map<string, () => Promise<unknown>>();
let restyling: Promise<void> | null = null;
/** Like warm-ups, background work for a SERVER: off until story's hooks are installed (commit-hooks.server). */
let restylesEnabled = false;
export function enableBackgroundRestyles(): void { restylesEnabled = true; }
function queueRestyle(stored: ArtifactRow, at: ArchivedRender | null): void {
  if (!restylesEnabled) return;
  const key = `${stored.id}\u0000${slotOf(at)}`;
  if (restyles.has(key) || restyles.size >= RESTYLES_QUEUED) return;
  restyles.set(key, () => reprepareStoredPage(stored, at));
  restyling ??= Promise.resolve().then(async () => {
    for (let next = restyles.entries().next(); !next.done; next = restyles.entries().next()) {
      const [id, job] = next.value;
      try { await job(); } catch (error) { console.warn('[prepared-page] background re-preparation failed', id, error); }
      finally { restyles.delete(id); }
    }
  }).finally(() => { restyling = null; });
}

/**
 * The stored entry for this version when it is current, else a fresh one, written back. A current entry
 * prepared under an older stylesheet (`stale`) is served as stored while it is re-prepared in the background.
 */
export async function preparedPageFor(stored: ArtifactRow, at: ArchivedRender | null): Promise<{ row: ArtifactRow; page: PreparedPage; stale?: true }> {
  const row = await servedRow(stored, at);
  const key = keyOf(row);
  const slot = slotOf(at);
  const db = await getDb();
  const found = (await db.query<StoredRow>('SELECT page_key, deps, page, page_format, handover_contract, css_version FROM prepared_pages WHERE artifact_id = $1 AND slot = $2', [row.id, slot])).rows[0];
  if (found && found.page_key === key && found.page.compiled) {
    // Older list commands stored li > li. A new runtime cannot correct pinned
    // compiled HTML, and recompiling cached nodes would retain that malformed
    // input. Re-prepare only affected trees from the unchanged stored document,
    // waiting so the first reader receives the repair; write only this cache key.
    if (fixHtmlNesting(found.page.data.nodes) !== found.page.data.nodes) {
      const page = await prepareNow(row, at);
      await store(row, slot, page, key);
      return { row, page };
    }
    const page = { ...found.page, pageFormat: found.page_format ?? 0, handoverContract: found.handover_contract ?? 0, cssVersion: found.css_version };
    if (found.css_version === preparedCssVersion()) return { row, page };
    queueRestyle(stored, at);
    return { row, page, stale: true };
  }
  const page = await prepareNow(row, at);
  await store(row, slot, page);
  return { row, page };
}

/**
 * RECOMPILE A STORED PAGE deliberately, or after a hand-raised compatibility minimum (§6). The
 * compile (or its recorded failure) is written back beside the page — only onto the entry this read
 * was served from (the same key), so a newer entry written meanwhile is never overwritten with an
 * older version's compile. Null when this deployment does not compile.
 */
export async function recompilePage(row: ArtifactRow, at: ArchivedRender | null, page: PreparedPage): Promise<StoredCompile | null> {
  const compiler = compilerBuild();
  if (!compiler) return null;
  const compiled = await compiledFor(row, page, await refDataForRow(row), compiler);
  page.pageFormat = PAGE_FORMAT;
  page.handoverContract = MIN_HANDOVER_CONTRACT;
  page.compiled = compiled;
  try {
    const db = await getDb();
    // Only over the entry this page was read from, stylesheet included: a background re-preparation that landed
    // meanwhile (a newer sheet) is never overwritten with this page's older one. The stylesheet version stays the page's own.
    await db.query(
      `UPDATE prepared_pages SET page = $4::jsonb, compiler_version = $5, island_build = $6,
       ssr_bundle = $8, page_format = $9, handover_contract = $10, updated_at = now()
       WHERE artifact_id = $1 AND slot = $2 AND page_key = $3 AND css_version IS NOT DISTINCT FROM $7`,
      [row.id, slotOf(at), keyOf(row), JSON.stringify(page), compilerFingerprint(), compiled.build, page.cssVersion ?? null, null, PAGE_FORMAT, MIN_HANDOVER_CONTRACT],
    );
  } catch (error) {
    console.warn('[prepared-page] compile write-back failed', row.id, error);
  }
  return compiled;
}

/**
 * THE READER'S RUNTIME for one request. `storyHtml` supplies static compiled
 * markup to remaining editor/API consumers; reader data is rendered by the
 * compiled serve path.
 */
export async function servedPage(row: ArtifactRow, page: PreparedPage, reader: ReaderContext): Promise<{ runtime: ServedStoryRuntime & { css: string }; storyHtml: () => string }> {
  // Only the head's answers are the query route's: an archived render, and a
  // version that cannot run (its declarations already carry every answer), serve none.
  const servable = reader.results && !reader.at && page.declared && !page.declared.state ? page.declared.flow : null;
  const [overlay, results] = await Promise.all([
    readerInputFor(row, page, reader),
    servable ? servedResultsFor(row, servable, { admit: reader.results!.admit, viewer: reader.viewer, search: reader.search }) : Promise.resolve(null),
  ]);
  // Results belong to this request's runtime; compiledPageFor renders them into the page.
  const input: ReaderOverlay = results && overlay.dataflow ? { ...overlay, dataflow: { ...overlay.dataflow, results } } : overlay;
  const runtime = servedOf(page, input);
  return {
    runtime,
    storyHtml: () => renderStory(page, input),
  };
}

/*
 * PUBLISH-TIME PREPARATION. After a write commits, the new head is prepared
 * off the write's path: one worker, one pending entry per artifact (a burst
 * of edits prepares the last head once), every failure swallowed — a warm-up
 * that fails is a first reader who misses, nothing more. Background work
 * belongs to a SERVER: it is queued by story's after-commit listener
 * (commit-hooks.server installStoryCommitHooks), which only the serving
 * composition registers. A caller that writes without serving — a script, a
 * unit test measuring one statement — gets no work behind its back, and its
 * readers still miss and write back.
 */
const queued = new Map<string, { row?: ArtifactRow; replace?: boolean }>();
let worker: Promise<void> | null = null;

/**
 * `row`: the head the caller already read and decoded (lib/artifacts settleCommittedHead), so it is not read again.
 * `replace`: the stored head page was rendered before something it shows changed (diagrams drawn since): drop it
 * first, so the head is prepared again rather than found prepared. Sticky across a burst for the same artifact.
 */
export function warmPreparedPage(id: string, row?: ArtifactRow, opts: { replace?: boolean } = {}): void {
  const replace = !!opts.replace || !!queued.get(id)?.replace;
  queued.set(id, { ...(row ? { row } : {}), ...(replace ? { replace } : {}) });
  if (worker) return;
  // A microtask, not a timer: a test's fake clock must never strand the queue.
  worker = Promise.resolve().then(async () => {
    while (queued.size) {
      const [next, { row: held, replace: drop }] = queued.entries().next().value!;
      queued.delete(next);
      try {
        // Decoded, never MIGRATED: a warm-up writes nothing but its own cache (a first reader's
        // read still performs the lazy representation migration it always has).
        const db = await getDb();
        if (drop) await db.query("DELETE FROM prepared_pages WHERE artifact_id=$1 AND slot='head'", [next]);
        const row = held ?? (await artifactQuery<ArtifactRow>(db, `SELECT * FROM artifacts WHERE id = $1 AND ${LIVE_ARTIFACT_SQL}`, [next])).rows[0];
        if (row?.format === 'markup') await preparedPageFor(row, null);
      } catch (error) {
        console.warn('[prepared-page] warm-up failed', next, error);
      }
    }
  }).finally(() => { worker = null; });
}

/** Wait for every queued warm-up and background re-preparation (tests; a graceful shutdown). */
export async function drainPreparedPageWarmups(): Promise<void> {
  while (worker || restyling) await (worker ?? restyling);
}
