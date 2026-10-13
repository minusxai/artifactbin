/**
 * THE PREPARED PAGE — each document version compiled for the reader ONCE.
 *
 * Serving a document used to parse its source, resolve glyphs and fonts,
 * rewrite ~140 KB of CSS with css-tree and render it on the server on EVERY
 * request. Everything in that work that belongs to the VERSION is done once
 * here and stored (app.prepared_pages):
 *
 *   - the isolated stylesheet (exactly what lib/page-styles/inline-css produces) and
 *     the node tree with the style values that policy rewrote (style-overrides);
 *   - glyphs, fonts, the resolved colour mode, the lazy-code manifest, the
 *     declared dataflow and the pinned compiled page.
 *
 * STORED IN THREE PARTS (app.prepared_pages): the shell (`page`: everything above except the
 * tree and the compiled page — its size does not grow with the document), the node tree
 * (`nodes`) and the compiled page (`compiled`). A reader asks for the parts it uses
 * (`preparedPageFor(row, at, { nodes, compiled })`) and the database sends only those: the app
 * page reads the shell, `?part=nodes` the tree, a document's own origin the compiled page.
 * A page stored whole by an earlier deployment is rewritten into parts on its next read.
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
import { archivedReadOnly, type ArchivedRender, type ArtifactHeader, type ArtifactRow, declarationsForRow, mentionedPeople, savedMentionStates, servableHeader, servedRow } from '@/lib/artifacts';
import { holdableImports, refDataForRow, viewerIdentityFor } from '@/lib/document-data';
import { artifactQuery, LIVE_ARTIFACT_SQL } from '@/lib/artifacts/table';
import type { AccessActor } from '@/lib/accounts';
import { currentStoryCss } from '@/lib/data/story/story-css.server';
import { preparedCssVersion } from './css-version.server';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { lookupWebAssets } from '../assets/web-assets';
import { collectExternalAssetUrls, lazyCodeOf, type LazyCode, fixHtmlNesting, storyBodyFor } from '../../document';
import { storedCompiledDataflow } from '@/lib/document/server';
import { prepareStoryParts, readerIslandData, type ReaderIslandInput } from './prepare-runtime.server';
import { assetsPath, inlineStoryCss, inlineStoryNodes, mutatePath, queryPath, type StoryBaseCssRecipe, type StyleOverride, styleOverrides } from '@/lib/page-styles';
import { readerStorySheet } from './reader-sheet.server';
import { mermaidImagesForCodes, prerenderableCodes } from '@/lib/mermaid-images/store';
import {
  archiveSharedBuild, type CompilerBuild, createSpeculationRulesStore, loadCompilerBuild,
  type CompiledPage, MIN_HANDOVER_CONTRACT, MIN_PAGE_FORMAT, type StoredCompile,
} from '@/lib/compiled-page';
import { readUrlValues } from '@/lib/dataflow';
import { servedResultsFor } from './served-results.server';
import type { ServedStoryRuntime } from './prepared-runtime';
import type { JsxNode } from '@/lib/jsx';
import type { StoryIslandData, StoryIslandDataflow } from '@/lib/story-runtime/contract';
import type { StoryDesignName } from '@/lib/validation/atlas-schemas';
import { prepareWorkers } from './prepare-workers.server';
import { declaredCspExtensions } from '@/lib/trust/document-trust';
import type { CspExtensions } from '@/lib/document';

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
  /**
   * The builder's messages when this version's Helmet script does not build under today's API: the page is served
   * without it (`authorScript` null), says so to its readers (lib/compiled-page/assembler) and tells its editors why
   * (lib/serving/artifact-page). Absent when the script built or there is none.
   */
  authorScriptErrors?: string[];
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
  /** The diagram codes a harvest may store a drawing for (lib/mermaid-images): what a reader looks drawings up by without loading the tree. */
  mermaidCodes: string[];
  /**
   * The hosts this version's source declares (lib/trust/document-trust `declaredCspExtensions`), derived once per version
   * so a validator is named from the row's header without its source ({@link preparedHeadFor}). Absent on a page
   * prepared before it was recorded: its next full read fills it in.
   */
  declaredCsp?: CspExtensions;
}
interface PreparedDeps { datasets: string[]; assets: string[] }

/**
 * The compiled page's bulk: its story HTML and what renders and links it, which only an answer with a body uses. A
 * validator (revalidation.server documentEtag) names the compile by everything else (`compiled: 'head'`), so a 304
 * never makes the database read, send or decode the bulk.
 */
const COMPILED_BULK = ['html', 'islands', 'outline', 'links', 'kit', 'reactStatic', 'partial', 'behaviors', 'authorScript'] as const;
/** A stored compile less its bulk: a recorded failure whole, a compiled page without {@link COMPILED_BULK}. */
type CompiledHead = Omit<CompiledPage, typeof COMPILED_BULK[number]> | Exclude<StoredCompile, CompiledPage>;
const headOf = (compiled: StoredCompile | undefined): CompiledHead | undefined => {
  if (!compiled || 'error' in compiled) return compiled;
  const head: Partial<CompiledPage> = { ...compiled };
  for (const key of COMPILED_BULK) delete head[key];
  return head as CompiledHead;
};

/** Which of the heavy parts a reader uses. The shell (everything else) is always read. `compiled: 'head'`: the compile less its bulk. */
export interface PreparedParts { nodes?: boolean; compiled?: boolean | 'head' }
const WHOLE = { nodes: true, compiled: true } as const;
/** The version less its tree and its compiled page: what the app page reads. */
export type PreparedShell = Omit<PreparedPage, 'data' | 'compiled'> & { data: Omit<PreparedPage['data'], 'nodes'> };
/** The shell and the parts asked for: `{ nodes: true }` adds `data.nodes`, `{ compiled: true }` adds `compiled`, `{ compiled: 'head' }` its head. */
export type PreparedView<P extends PreparedParts = typeof WHOLE> = PreparedShell
  & (P extends { nodes: true } ? { data: PreparedPage['data'] } : unknown)
  & (P extends { compiled: true } ? Pick<PreparedPage, 'compiled'> : P extends { compiled: 'head' } ? { compiled?: CompiledHead } : unknown);
/** A served runtime without the tree (`?part=nodes` is its door). */
export type TreelessServedRuntime = Omit<ServedStoryRuntime, 'data'> & { data: Omit<StoryIslandData, 'nodes'>; css: string };

/** What a request (never the document) decides about its render. */
interface ReaderContext {
  at: ArchivedRender | null;
  viewer: AccessActor | null;
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
   * Serve this request's first results (lib/publish/prepared/served-results.server),
   * admitted as the page's query door admits this viewer. Absent: the page
   * fetches its own rows, as the stored anonymous render always does.
   */
  results?: { admit: AccessActor };
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
const keyOf = (row: Pick<ArtifactRow, 'version'>): string => `v:${row.version}`;

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
async function readerInputFor(row: ArtifactRow, page: Pick<PreparedPage, 'declared' | 'mermaidCodes'>, reader: ReaderContext): Promise<ReaderIslandInput & { colorMode?: 'light' | 'dark' }> {
  const { at, viewer, search } = reader;
  const declared = page.declared;
  const [refData, mentionStatuses, identity, hold, mermaidImages] = await Promise.all([
    refDataForRow(row), savedMentionStates(row), viewerIdentityFor(row, viewer?.userId ?? null),
    declared ? holdableImports(row, declared.flow, viewer) : Promise.resolve([]),
    reader.drawings === 'engine' ? Promise.resolve({}) : mermaidImagesForCodes({ artifactId: row.id, version: at?.version ?? row.version, surface: 'inline', head: !at, visibility: row.visibility }, page.mermaidCodes),
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
  // The reader's copy of the sheet: only what this story can match (lib/publish/prepared/reader-sheet.server).
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
    ...(runtime.authorScriptErrors ? { authorScriptErrors: runtime.authorScriptErrors } : {}),
    theme: runtime.theme, title: runtime.title, fontPreloads: runtime.fontPreloads ?? [],
    lazyCode: lazyCodeOf(nodes), declared: declared ?? null,
    deps: { datasets, assets: assetUrls }, mermaidCodes: prerenderableCodes(nodes), declaredCsp: declaredCspExtensions(row.source),
  };
  // An incident, not a known state: the operator's line names the version and the builder's words, never the source.
  if (runtime.authorScriptErrors) console.error(`[prepared-page] ${row.id} v${row.version}: the author script does not build and is served without it: ${runtime.authorScriptErrors.join('; ')}`);
  // Only the version's compiled output is stored; request data is rendered by its pinned SSR module.
  const anonymous = await readerInputFor(row, page, { at, viewer: null, search: '' });
  if (compiler) page.compiled = await compiledFor(row, page, anonymous.refData, compiler);
  return page;
}

function servedOf(page: PreparedShell, input: ReaderOverlay): TreelessServedRuntime {
  return {
    data: { ...page.data, ...readerIslandData(input), ...(input.colorMode ? { colorMode: input.colorMode } : {}) } as TreelessServedRuntime['data'],
    css: page.css, overrides: page.overrides, base: page.base,
    authorScript: page.authorScript, theme: page.theme, title: page.title, fontPreloads: page.fontPreloads,
  };
}

/** The version split along the stored parts. The shell carries nothing the columns beside it already say. */
function splitPage(page: PreparedPage): { shell: Omit<PreparedShell, 'pageFormat' | 'handoverContract' | 'cssVersion'>; nodes: JsxNode[]; compiled: StoredCompile | null } {
  const { data: { nodes, ...data }, compiled, ssr: _legacyRender, pageFormat: _format, handoverContract: _contract, cssVersion: _css, ...rest } = page;
  return { shell: { ...rest, data }, nodes, compiled: compiled ?? null };
}
/** The parts of `page` that were asked for, and no more (the shell is always there): a view never carries what its reader did not ask for. */
function narrow<P extends PreparedParts>(page: PreparedPage, want: P): PreparedView<P> {
  const { data: { nodes, ...data }, compiled, ...rest } = page;
  return { ...rest, data: want.nodes ? { ...data, nodes } : data, ...(want.compiled ? { compiled: want.compiled === 'head' ? headOf(compiled) : compiled } : {}) } as PreparedView<P>;
}

/** Write a fresh preparation back. `onlyKey`: only over the entry it replaces (a background re-preparation), never a newer one. */
async function store(row: ArtifactRow, slot: string, page: PreparedPage, onlyKey?: string): Promise<void> {
  try {
    const db = await getDb();
    const { shell, nodes, compiled } = splitPage(page);
    const params = [
      row.id, slot, keyOf(row), await fingerprint(page.deps), JSON.stringify(shell), JSON.stringify(nodes), compiled ? JSON.stringify(compiled) : null,
      mentionedPeople(row.source ?? ''), compilerFingerprint(), page.compiled?.build ?? 'none', page.cssVersion ?? null, null, PAGE_FORMAT, MIN_HANDOVER_CONTRACT,
    ];
    if (onlyKey) {
      await db.query(
        `UPDATE prepared_pages SET deps = $4, page = $5::jsonb, nodes = $6::jsonb, compiled = $7::jsonb, mentions = $8::text[], compiler_version = $9, island_build = $10,
         css_version = $11, ssr_bundle = $12, page_format = $13, handover_contract = $14, updated_at = now() WHERE artifact_id = $1 AND slot = $2 AND page_key = $3`,
        params,
      );
      return;
    }
    await db.query(
      `INSERT INTO prepared_pages (artifact_id, slot, page_key, deps, page, nodes, compiled, mentions, compiler_version, island_build, css_version, ssr_bundle, page_format, handover_contract, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::text[], $9, $10, $11, $12, $13, $14, now())
       ON CONFLICT (artifact_id, slot) DO UPDATE SET page_key = EXCLUDED.page_key, deps = EXCLUDED.deps, page = EXCLUDED.page, nodes = EXCLUDED.nodes,
       compiled = EXCLUDED.compiled, mentions = EXCLUDED.mentions, compiler_version = EXCLUDED.compiler_version, island_build = EXCLUDED.island_build,
       css_version = EXCLUDED.css_version, ssr_bundle = EXCLUDED.ssr_bundle, page_format = EXCLUDED.page_format, handover_contract = EXCLUDED.handover_contract, updated_at = now()`,
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
 * An entry stored whole by an earlier deployment (the tree and the compiled page inside `page`, or `page`
 * rewritten whole over a split row by a server that predates the split). Older list commands stored li > li:
 * a new runtime cannot correct pinned compiled HTML, and recompiling cached nodes would retain that malformed
 * input, so an affected tree is re-prepared from the unchanged stored document, waiting so the first reader
 * receives the repair (this key only). Any other is split in place, with no preparation, and read as stored.
 * Null: the entry is gone, was replaced meanwhile, or holds no compiled page; the caller prepares it.
 */
async function settleWhole(row: ArtifactRow, at: ArchivedRender | null, slot: string, key: string): Promise<PreparedPage | null> {
  const db = await getDb();
  const stored = (await db.query<{ page: PreparedPage; page_format: number | null; handover_contract: number | null; css_version: string | null }>(
    'SELECT page, page_format, handover_contract, css_version FROM prepared_pages WHERE artifact_id = $1 AND slot = $2 AND page_key = $3', [row.id, slot, key],
  )).rows[0];
  if (!stored?.page.compiled) return null;
  const page: PreparedPage = { ...stored.page, pageFormat: stored.page_format ?? 0, handoverContract: stored.handover_contract ?? 0, cssVersion: stored.css_version };
  if (fixHtmlNesting(page.data.nodes) !== page.data.nodes) {
    const repaired = await prepareNow(row, at);
    await store(row, slot, repaired, key);
    return repaired;
  }
  page.mermaidCodes ??= prerenderableCodes(page.data.nodes);
  const { shell, nodes, compiled } = splitPage(page);
  try {
    await db.query(
      `UPDATE prepared_pages SET page = $4::jsonb, nodes = $5::jsonb, compiled = $6::jsonb WHERE artifact_id = $1 AND slot = $2 AND page_key = $3
       AND (nodes IS NULL OR (page #> '{data,nodes}') IS NOT NULL)`,
      [row.id, slot, key, JSON.stringify(shell), JSON.stringify(nodes), JSON.stringify(compiled)],
    );
  } catch (error) {
    console.warn('[prepared-page] split write-back failed', row.id, slot, error);
  }
  return page;
}

/**
 * One statement: the shell, and of the tree and the compiled page ($3, $4) only those asked for — the compiled page
 * whole, or ($5) less its bulk ($6), cut in the database so the bulk never leaves it. A whole-stored entry (`legacy`)
 * is read whole by settleWhole.
 */
const READ_PARTS = `
  SELECT p.page_key, p.page_format, p.handover_contract, p.css_version, l.legacy, (p.compiled IS NOT NULL OR p.page ? 'compiled') AS has_compiled,
    CASE WHEN l.legacy THEN NULL ELSE p.page END AS page,
    CASE WHEN $3 AND NOT l.legacy THEN p.nodes END AS nodes,
    CASE WHEN l.legacy THEN NULL WHEN $4 THEN p.compiled WHEN $5 THEN p.compiled - $6::text[] END AS compiled
  FROM prepared_pages p, LATERAL (SELECT p.nodes IS NULL OR (p.page #> '{data,nodes}') IS NOT NULL AS legacy) l
  WHERE p.artifact_id = $1 AND p.slot = $2`;
interface StoredRow {
  page_key: string; page_format: number | null; handover_contract: number | null; css_version: string | null;
  legacy: boolean; has_compiled: boolean; page: PreparedShell | null; nodes: JsxNode[] | null; compiled: StoredCompile | CompiledHead | null;
}

/**
 * The stored entry for this version when it is current, else a fresh one, written back. A current entry
 * prepared under an older stylesheet (`stale`) is served as stored while it is re-prepared in the background.
 * `parts`: the tree and the compiled page are read only when asked for (both, when `parts` is omitted).
 */
export async function preparedPageFor<const P extends PreparedParts = typeof WHOLE>(stored: ArtifactRow, at: ArchivedRender | null, parts?: P): Promise<{ row: ArtifactRow; page: PreparedView<P>; stale?: true }> {
  // `P` is `typeof WHOLE` exactly when no parts were passed.
  const want = (parts ?? WHOLE) as P;
  const row = await servedRow(stored, at);
  const key = keyOf(row);
  const slot = slotOf(at);
  const db = await getDb();
  const found = (await db.query<StoredRow>(READ_PARTS, [row.id, slot, !!want.nodes, want.compiled === true, want.compiled === 'head', COMPILED_BULK])).rows[0];
  if (found && found.page_key === key && found.has_compiled) {
    const whole = found.legacy ? await settleWhole(row, at, slot, key) : null;
    if (whole || !found.legacy) {
      const page: PreparedView<P> = whole ? narrow(whole, want) : {
        ...found.page!, pageFormat: found.page_format ?? 0, handoverContract: found.handover_contract ?? 0, cssVersion: found.css_version,
        data: { ...found.page!.data, ...(want.nodes ? { nodes: found.nodes! } : {}) }, ...(want.compiled ? { compiled: found.compiled! } : {}),
      } as PreparedView<P>;
      // A page an earlier deployment prepared by dropping its script without a word is prepared again below, once.
      if (!droppedSilently(row, page)) {
        if (!page.declaredCsp) page.declaredCsp = await recordDeclaredCsp(row, slot, key);
        if (page.cssVersion === preparedCssVersion()) return { row, page };
        queueRestyle(stored, at);
        return { row, page, stale: true };
      }
    }
  }
  const page = await prepareNow(row, at);
  await store(row, slot, page);
  return { row, page: narrow(page, want) };
}

/** Versions whose source mentions `<script` with no Helmet script (prose about HTML): parsed once per process, not per read. */
const SCRIPTLESS_KEPT = 4096;
const scriptless = new Set<string>();
/**
 * A stored page with no script and no recorded failure whose version DOES declare a Helmet script: an earlier
 * deployment prepared it when the script no longer built and kept nothing but a warning. Preparing it again records
 * the failure ({@link PreparedPage.authorScriptErrors}) or, should it build now, the script; either way never again.
 * Only a version whose source names `<script` at all is parsed, and its verdict is remembered.
 */
function droppedSilently(row: ArtifactRow, page: Pick<PreparedPage, 'authorScript' | 'authorScriptErrors'>): boolean {
  if (page.authorScript || page.authorScriptErrors || !row.source?.includes('<script')) return false;
  const key = `${row.id}@${row.version}`;
  if (scriptless.has(key)) return false;
  if (storyBodyFor(row.source)?.content.script) return true;
  if (scriptless.size >= SCRIPTLESS_KEPT) scriptless.clear();
  scriptless.add(key);
  return false;
}

/**
 * THE LAZY FILL of {@link PreparedPage.declaredCsp} for a page prepared before it was recorded: derived from the
 * version's source this read already holds and written onto that same entry (never a newer one). A failed write is
 * a header read that falls back to the whole row once more, never a failed read.
 */
async function recordDeclaredCsp(row: ArtifactRow, slot: string, key: string): Promise<CspExtensions> {
  const declared = declaredCspExtensions(row.source);
  try {
    const db = await getDb();
    await db.query(
      "UPDATE prepared_pages SET page = page || jsonb_build_object('declaredCsp', $4::jsonb) WHERE artifact_id = $1 AND slot = $2 AND page_key = $3",
      [row.id, slot, key, JSON.stringify(declared)],
    );
  } catch (error) {
    console.warn('[prepared-page] declared hosts write-back failed', row.id, slot, error);
  }
  return declared;
}

/**
 * THE HEAD VERSION'S STORED PAGE, NAMED FROM THE ROW'S HEADER — its shell and its compile's head, for a validator
 * (revalidation.server documentEtag), with no read of the row's `source` or `document`. Only an entry that needs
 * nothing of them answers: current for the header's version, split, compiled, prepared under this deployment's
 * stylesheet, and carrying the version's declared hosts. Such an entry is prepared only from a row
 * `servedRow` passed (lib/artifacts/servable), so it stands for that version's servable verdict; `servableHeader`
 * judges the rest from the header. Anything else is null and the caller reads the row whole — which prepares, fills
 * the declared hosts in, and queues a stale page's re-preparation (that needs the source, so it is never queued here).
 */
export async function preparedHeadFor(header: ArtifactHeader): Promise<{ row: ArtifactHeader; page: PreparedView<{ compiled: 'head' }> } | null> {
  if (!servableHeader(header)) return null;
  const db = await getDb();
  const found = (await db.query<StoredRow>(READ_PARTS, [header.id, slotOf(null), false, false, true, COMPILED_BULK])).rows[0];
  if (!found || found.legacy || !found.has_compiled || found.page_key !== keyOf(header) || !found.page?.declaredCsp) return null;
  if (found.css_version !== preparedCssVersion()) return null;
  const page = {
    ...found.page, pageFormat: found.page_format ?? 0, handoverContract: found.handover_contract ?? 0, cssVersion: found.css_version,
    compiled: found.compiled as CompiledHead,
  } as PreparedView<{ compiled: 'head' }>;
  return { row: header, page };
}

/**
 * RECOMPILE A STORED PAGE deliberately, or after a hand-raised compatibility minimum (§6). The
 * compile (or its recorded failure) is written back beside the page — only onto the entry this read
 * was served from (the same key), so a newer entry written meanwhile is never overwritten with an
 * older version's compile. Null when this deployment does not compile.
 */
export async function recompilePage(row: ArtifactRow, at: ArchivedRender | null, page: PreparedShell & Pick<PreparedPage, 'compiled'>): Promise<StoredCompile | null> {
  const compiler = compilerBuild();
  if (!compiler) return null;
  const db = await getDb();
  // The compile needs the tree, which a reader of the shell did not load: read it now, from this entry only.
  const nodes = (await db.query<{ nodes: JsxNode[] | null }>(
    "SELECT COALESCE(page #> '{data,nodes}', nodes) AS nodes FROM prepared_pages WHERE artifact_id = $1 AND slot = $2 AND page_key = $3", [row.id, slotOf(at), keyOf(row)],
  )).rows[0]?.nodes;
  if (!nodes) return null;
  const compiled = await compiledFor(row, { ...page, data: { ...page.data, nodes } }, await refDataForRow(row), compiler);
  page.pageFormat = PAGE_FORMAT;
  page.handoverContract = MIN_HANDOVER_CONTRACT;
  page.compiled = compiled;
  try {
    // Only over the entry this page was read from, stylesheet included: a background re-preparation that landed
    // meanwhile (a newer sheet) is never overwritten with this page's older one. The stylesheet version stays the page's own.
    // The same statement finishes the split of an entry still stored whole, so its old compile cannot outlive this one.
    await db.query(
      `UPDATE prepared_pages SET compiled = $4::jsonb, nodes = COALESCE(page #> '{data,nodes}', nodes), page = (page - 'compiled') #- '{data,nodes}',
       compiler_version = $5, island_build = $6, ssr_bundle = $8, page_format = $9, handover_contract = $10, updated_at = now()
       WHERE artifact_id = $1 AND slot = $2 AND page_key = $3 AND css_version IS NOT DISTINCT FROM $7`,
      [row.id, slotOf(at), keyOf(row), JSON.stringify(compiled), compilerFingerprint(), compiled.build, page.cssVersion ?? null, null, PAGE_FORMAT, MIN_HANDOVER_CONTRACT],
    );
  } catch (error) {
    console.warn('[prepared-page] compile write-back failed', row.id, error);
  }
  return compiled;
}

/**
 * THE READER'S RUNTIME for one request: the version's shell overlaid with what only this request decides.
 * The compiled serve path renders the page itself; the app page reads this for its dataflow and sheet.
 */
export async function servedPage(row: ArtifactRow, page: PreparedShell, reader: ReaderContext): Promise<{ runtime: TreelessServedRuntime }> {
  // Only the head's answers are the query route's: an archived render, and a
  // version that cannot run (its declarations already carry every answer), serve none.
  const servable = reader.results && !reader.at && page.declared && !page.declared.state ? page.declared.flow : null;
  const [overlay, results] = await Promise.all([
    readerInputFor(row, page, reader),
    servable ? servedResultsFor(row, servable, { admit: reader.results!.admit, viewer: reader.viewer, search: reader.search }) : Promise.resolve(null),
  ]);
  // Results belong to this request's runtime; compiledPageFor renders them into the page.
  const input: ReaderOverlay = results && overlay.dataflow ? { ...overlay, dataflow: { ...overlay.dataflow, results } } : overlay;
  return { runtime: servedOf(page, input) };
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
