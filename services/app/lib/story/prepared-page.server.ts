/**
 * THE PREPARED PAGE — each document version compiled for the reader ONCE.
 *
 * Serving a document used to parse its source, resolve glyphs and fonts,
 * rewrite ~140 KB of CSS with css-tree and render it on the server on EVERY
 * request. Everything in that work that belongs to the VERSION is done once
 * here and stored (app.prepared_pages):
 *
 *   - the isolated stylesheet (exactly what lib/story/inline-css produces) and
 *     the node tree with the style values that policy rewrote (style-overrides);
 *   - glyphs, fonts, the resolved colour mode, the lazy-code manifest, the
 *     declared dataflow;
 *   - the ANONYMOUS reader's server render of the story, with a digest of the
 *     per-reader inputs it was rendered with.
 *
 * Nothing per viewer is stored. A request overlays what only it decides — who
 * reads, their `$` values, what they may hold, the other artifacts the document
 * embeds — through the same writer the whole preparation uses
 * (prepare-runtime.server `readerIslandData`), and reuses the stored render only
 * when that overlay is byte-identical to the one it was rendered with. The
 * first reader of a version may be its owner; the stored render is still the
 * anonymous one.
 *
 * WHEN AN ENTRY IS STALE: its key is a digest of every stored field
 * preparation reads (source, meta, title, format) plus the CSS compile version
 * and the server build, so a representation-only migration, a new Tailwind
 * union or a deploy all miss. Inputs owned by OTHER rows — the datasets an
 * uncompiled document's data compiles against, the web assets it holds copies
 * of, the fonts it imports — are fingerprinted and checked on every read. A
 * miss prepares, serves and writes back; the write never fails the read.
 *
 * Produced at publish too (warmPreparedPage, after commit, off the write's
 * path) so the first reader of a new version is already a hit.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '@/lib/db';
import { ASSETS_ORIGIN, COMPILED_READER, IS_DEV, PUBLIC_BASE_URL } from '@/lib/config';
import type { ArtifactRow, Viewer } from '@/lib/artifacts';
import { declarationsForRow, holdableImports, LIVE_ARTIFACT_SQL, refDataForRow, viewerIdentityFor, type RoleActor } from '@/lib/artifacts';
import { artifactQuery } from '@/lib/artifact-document';
import { savedMentionStates } from '@/lib/membership';
import { archivedReadOnly, servedRow, type ArchivedRender } from '@/lib/archived-version';
import { currentStoryCss, storyCssCompileVersion } from '@/lib/data/story/story-css.server';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { lookupWebAssets } from '@/lib/web-assets';
import { webFontAssets } from '@/lib/webfonts';
import { collectExternalAssetUrls } from './external-images';
import { storedCompiledDataflow } from './parsed-artifact-metadata';
import { prepareStoryParts, readerIslandData, type ReaderIslandInput } from './prepare-runtime.server';
import { inlineStoryCss, inlineStoryNodes } from './inline-css';
import { styleOverrides, type StyleOverride } from './style-overrides';
import { readerStorySheet } from './reader-sheet.server';
import { mermaidImagesFor } from '@/lib/mermaid-images/store';
import { servedStoryHtml } from '@/lib/story/legacy-story-html';
import { loadStorySsr } from './ssr.server';
import { lazyCodeOf, type LazyCode } from './lazy-code';
import { assetsPath, mutatePath, queryPath } from './markup-csp';
import { readUrlValues } from './url-values';
import { servedResultsFor } from './served-results.server';
import type { StoryBaseCssRecipe } from './story-base-css';
import type { ServedStoryRuntime } from './prepared-runtime';
import type { StoryIslandData, StoryIslandDataflow } from '@/lib/story-runtime/contract';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { createSpeculationRulesStore } from '@/lib/compiled-page/modules.server';
import { compilesPages, currentCompiledReaderFlag } from '@/lib/compiled-page/reader-mode';
import type { CompilerBuild, StoredCompile } from '@/lib/compiled-page/contract';

/** Bump when the stored shape changes; old entries then miss and are overwritten. */
const PAGE_FORMAT = 2;

/** One version, prepared for the reader. Nothing in it depends on who reads. */
export interface PreparedPage {
  data: Pick<StoryIslandData, 'nodes' | 'colorMode' | 'template' | 'chrome' | 'glyphs'>;
  css: string;
  overrides: StyleOverride[];
  base: StoryBaseCssRecipe;
  /** The raw authored `<style>`: the editor's door only (never the reader payload). */
  authorCss: string | null;
  authorScript: string | null;
  theme: StoryThemeName | null;
  title: string;
  fontPreloads: string[];
  lazyCode: LazyCode;
  /** The declared dataflow — declarations, or a version's answers when it cannot run. */
  declared: StoryIslandDataflow | null;
  /** What other rows this entry was built from; fingerprinted on every read. */
  deps: PreparedDeps;
  /** The anonymous reader's render of the story element, and the digest of the overlay it was rendered with. */
  ssr: { overlay: string; html: string } | null;
  /** The compiled page (lib/compiled-page), or its recorded failure; absent while the deployment does not compile (`FLAG__COMPILED_READER=off`). */
  compiled?: StoredCompile;
}
interface PreparedDeps { datasets: string[]; assets: string[]; fonts: string[] }

/** What a request (never the document) decides about its render. */
export interface ReaderContext {
  at: ArchivedRender | null;
  viewer: RoleActor | null;
  /** The page's query string — the reader's `$` values. */
  search: string;
  /** The origin the page is served on (managed assets resolve through it). */
  origin: string;
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
   * Serve this request's first results (lib/story/served-results.server),
   * admitted as the page's query door admits this viewer. Absent: the page
   * fetches its own rows, as the stored anonymous render always does.
   */
  results?: { admit: Viewer };
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

let staticBuild: string | null = null;
/**
 * Everything that produces a stored byte: the SSR bundle and this server's own
 * code (in production, the one bundled file this module is part of). A
 * development server is rebuilt at will, so its entries live for its process.
 */
function buildId(): string {
  if (staticBuild && !IS_DEV) return staticBuild;
  const hash = createHash('sha256');
  const read = (file: string) => { try { hash.update(readFileSync(file)); } catch { hash.update(`missing:${file}`); } };
  read(path.join(process.cwd(), 'lib', 'story-runtime', 'dist', 'story-ssr.cjs'));
  read(fileURLToPath(import.meta.url));
  if (IS_DEV) hash.update(String(BOOT));
  return (staticBuild = hash.digest('hex').slice(0, 16));
}
const BOOT = Date.now();

/**
 * JSON with its object keys in one order. The overlay carries the STORED flow,
 * and a JSONB column hands objects back in its own key order: a digest of plain
 * JSON would call a byte-identical overlay different, and never reuse a render.
 */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v);
const slotOf = (at: ArchivedRender | null): string => (at ? `v:${at.version}` : 'head');
/** The compiler this deployment compiles with, or null when it does not compile (the flag is `off`). */
function compilerBuild(): { build: CompilerBuild | null; error: string | null } | null {
  if (!compilesPages(currentCompiledReaderFlag(COMPILED_READER))) return null;
  try {
    return { build: loadCompilerBuild(), error: null };
  } catch (error) {
    // No island build (never run, or unreadable): recorded as a failure, never a failed read.
    return { build: null, error: error instanceof Error ? error.message : String(error) };
  }
}
/** Every stored field preparation reads, the CSS compile version, the build, and the compiler build (a deploy or a flag change misses). */
const keyOf = (row: ArtifactRow, compiler: ReturnType<typeof compilerBuild>): string =>
  `${PAGE_FORMAT}:${sha(canonical([row.format, row.title, row.meta, row.source ?? '', !!row.previousEngine]))}:${storyCssCompileVersion()}:${buildId()}:${compiler ? compiler.build?.id ?? 'none' : 'off'}`;

/** The current state of the other rows an entry was built from. Empty when it depends on none. */
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
  if (deps.fonts.length) parts.push(await webFontAssets(deps.fonts));
  return parts.length ? sha(JSON.stringify(parts)) : '';
}

/** The per-reader half of the island, through the one writer (readerIslandData). */
async function readerInputFor(row: ArtifactRow, page: Pick<PreparedPage, 'declared' | 'data'>, reader: ReaderContext): Promise<ReaderIslandInput & { colorMode?: 'light' | 'dark' }> {
  const { at, viewer, search, origin } = reader;
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
    ...(ASSETS_ORIGIN ? { managedAssets: { origin: ASSETS_ORIGIN, resolveUrl: `${origin}${assetsPath(row.id)}` } } : {}),
    // A snapshot render refuses every write by name, and carries no write door at all (above).
    ...(at ? { readOnly: archivedReadOnly(at.version) } : {}),
  };
}
type ReaderOverlay = ReaderIslandInput & { colorMode?: 'light' | 'dark' };
const overlayDigest = (input: ReaderOverlay): string => sha(canonical({ ...readerIslandData(input), ...(input.colorMode ? { colorMode: input.colorMode } : {}) }));

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
    // Imported on first compile, not at the top: the compiler carries Babel, Solid and today's React
    // kit (it renders static components at compile time), and this module sits under lib/artifacts,
    // which every tool that reads artifacts loads (the CLI's teaching build among them). A process
    // that never compiles (`FLAG__COMPILED_READER=off`) never loads any of it. The snapshot store
    // imports this module, so its access helper is reached the same way (no import cycle at load).
    const [{ compilePage }, { anonymousAccessFacts }] = await Promise.all([import('@/lib/compiled-page/compiler'), import('@/lib/compiled-page/snapshots.server')]);
    const flow = page.declared?.flow ?? null;
    const compiled = await compilePage({
      nodes: page.data.nodes, colorMode: page.data.colorMode, template: page.data.template ?? null, chrome: page.data.chrome !== false,
      ...(page.data.glyphs ? { glyphs: page.data.glyphs } : {}),
      refData: refData ?? {}, flow, build: build.id, authorScript: page.authorScript,
      // The plan snapshots key on: the anonymous reader's admission, decided as the snapshot store decides it.
      ...(flow ? { access: await anonymousAccessFacts(row, flow) } : {}),
    }, build);
    if (compiled.unported.length) return { build: build.id, error: `unported: ${compiled.unported.join(', ')}`, reason: 'unported', unported: compiled.unported };
    await createSpeculationRulesStore().put(compiled.links.prerender);
    return compiled;
  } catch (error) {
    console.warn('[prepared-page] compile failed', error);
    return { build: build.id, error: error instanceof Error ? error.message : String(error), reason: 'compile-error' };
  }
}

/** Parse, isolate and render one version. The only place a served document is compiled. */
async function build(row: ArtifactRow, at: ArchivedRender | null, origin: string, compiler: ReturnType<typeof compilerBuild>): Promise<PreparedPage> {
  const meta = (row.meta ?? {}) as { theme?: StoryThemeName | null; colorMode?: 'light' | 'dark' | null; template?: string | null; compiledCss?: string | null; cssCompileVersion?: string | null; refs?: Array<{ id: string; kind: string }> };
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
  // The reader's copy of the sheet: only what this story can match (lib/story/reader-sheet.server).
  const sheet = { ...runtime, compiledCss: readerStorySheet(compiledCss, { source, nodes, theme: design.theme }) };
  const css = inlineStoryCss(sheet);
  const overrides = styleOverrides(nodes, inlineStoryNodes(nodes, sheet));
  // A document whose compiled data is stored with its source compiles against nothing else.
  const compiledElsewhere = !!row.source && !row.previousEngine && !storedCompiledDataflow(row.meta, row.source);
  const datasets = compiledElsewhere
    ? [...new Set([...(declared?.flow.imports ?? []).map((i) => i.ref), ...(meta.refs ?? []).filter((r) => r.kind === 'dataset').map((r) => r.id)])].sort()
    : [];
  const page: PreparedPage = {
    data: {
      nodes, colorMode: runtime.data.colorMode, template: runtime.data.template ?? null, chrome: runtime.data.chrome,
      ...(runtime.data.glyphs ? { glyphs: runtime.data.glyphs } : {}),
    },
    css, overrides, base: parts.baseRecipe, authorCss: runtime.authorCss, authorScript: runtime.authorScript,
    theme: runtime.theme, title: runtime.title, fontPreloads: runtime.fontPreloads ?? [],
    lazyCode: lazyCodeOf(nodes), declared: declared ?? null,
    deps: { datasets, assets: assetUrls, fonts: parts.docFonts.families },
    ssr: null,
  };
  // The anonymous reader's render, whoever asked first.
  const anonymous = await readerInputFor(row, page, { at, viewer: null, search: '', origin });
  page.ssr = { overlay: overlayDigest(anonymous), html: renderStory(page, anonymous) };
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
const renderStory = (page: PreparedPage, input: ReaderOverlay): string => servedStoryHtml(servedOf(page, input), loadStorySsr().renderInlineStory);

interface StoredRow { page_key: string; deps: string; page: PreparedPage }

/** The stored entry for this version when it is current, else a fresh one, written back. */
export async function preparedPageFor(stored: ArtifactRow, at: ArchivedRender | null, origin: string): Promise<{ row: ArtifactRow; page: PreparedPage }> {
  const row = await servedRow(stored, at);
  const compiler = compilerBuild();
  const key = keyOf(row, compiler);
  const slot = slotOf(at);
  const db = await getDb();
  const found = (await db.query<StoredRow>('SELECT page_key, deps, page FROM prepared_pages WHERE artifact_id = $1 AND slot = $2', [row.id, slot])).rows[0];
  if (found && found.page_key === key && found.deps === await fingerprint(found.page.deps)) return { row, page: found.page };
  const page = await build(row, at, origin, compiler);
  try {
    await db.query(
      `INSERT INTO prepared_pages (artifact_id, slot, page_key, deps, page, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, now())
       ON CONFLICT (artifact_id, slot) DO UPDATE SET page_key = EXCLUDED.page_key, deps = EXCLUDED.deps, page = EXCLUDED.page, updated_at = now()`,
      [row.id, slot, key, await fingerprint(page.deps), JSON.stringify(page)],
    );
  } catch (error) {
    // A cache that cannot be written is a slower next read, never a failed one.
    console.warn('[prepared-page] write-back failed', row.id, slot, error);
  }
  return { row, page };
}

/**
 * RECOMPILE A STORED PAGE with this deployment's compiler (docs/phase2-architecture.md §6): the
 * stored compile is from another build, or no island build could be read when it was made. The
 * compile (or its recorded failure) is written back beside the page — only onto the entry this read
 * was served from (the same key), so a newer entry written meanwhile is never overwritten with an
 * older version's compile. Null when this deployment does not compile. The serve path
 * (lib/compiled-page/serve.server) races it against its inline budget; a compile that loses the race
 * still lands here and the next read is a hit.
 */
export async function recompilePage(row: ArtifactRow, at: ArchivedRender | null, page: PreparedPage): Promise<StoredCompile | null> {
  const compiler = compilerBuild();
  if (!compiler) return null;
  const compiled = await compiledFor(row, page, await refDataForRow(row), compiler);
  try {
    const db = await getDb();
    await db.query(
      `UPDATE prepared_pages SET page = jsonb_set(page, '{compiled}', $4::jsonb), updated_at = now() WHERE artifact_id = $1 AND slot = $2 AND page_key = $3`,
      [row.id, slotOf(at), keyOf(row, compiler), JSON.stringify(compiled)],
    );
  } catch (error) {
    console.warn('[prepared-page] compile write-back failed', row.id, error);
  }
  return compiled;
}

/**
 * THE READER'S RUNTIME for one request: the stored version under this
 * request's overlay. `storyHtml` renders only when the overlay differs from
 * the one the stored render was made with.
 */
export async function servedPage(row: ArtifactRow, page: PreparedPage, reader: ReaderContext): Promise<{ runtime: ServedStoryRuntime & { css: string }; storyHtml: () => string }> {
  // Only the head's answers are the query route's: an archived render, and a
  // version that cannot run (its declarations already carry every answer), serve none.
  const servable = reader.results && !reader.at && page.declared && !page.declared.state ? page.declared.flow : null;
  const [overlay, results] = await Promise.all([
    readerInputFor(row, page, reader),
    servable ? servedResultsFor(row, servable, { admit: reader.results!.admit, viewer: reader.viewer, search: reader.search }) : Promise.resolve(null),
  ]);
  /*
   * The results ride in the overlay, beside the request's other facts (its
   * stored diagram drawings), so its digest differs from the stored anonymous
   * render's and the story is rendered fresh WITH them. The stored render
   * never holds data: its key does not follow the datasets.
   */
  const input: ReaderOverlay = results && overlay.dataflow ? { ...overlay, dataflow: { ...overlay.dataflow, results } } : overlay;
  const runtime = servedOf(page, input);
  return {
    runtime,
    // An overlay carrying results can never be the stored one's: render it, and hash nothing the size of its rows.
    storyHtml: () => (!results && page.ssr && page.ssr.overlay === overlayDigest(input) ? page.ssr.html : renderStory(page, input)),
  };
}

/*
 * PUBLISH-TIME PREPARATION. After a write commits, the new head is prepared
 * off the write's path: one worker, one pending entry per artifact (a burst
 * of edits prepares the last head once), every failure swallowed — a warm-up
 * that fails is a first reader who misses, nothing more.
 */
const queued = new Map<string, string>();
let worker: Promise<void> | null = null;
let warming = false;

/**
 * Background work belongs to a SERVER: the app's composition (server/app
 * createAppServer) turns publish-time preparation on. A caller that writes
 * without serving — a script, a unit test measuring one statement — gets no
 * work behind its back, and its readers still miss and write back.
 */
export function enablePreparedPageWarmups(): void { warming = true; }

export function warmPreparedPage(id: string, origin: string = PUBLIC_BASE_URL): void {
  if (!warming) return;
  queued.set(id, origin);
  if (worker) return;
  // A microtask, not a timer: a test's fake clock must never strand the queue.
  worker = Promise.resolve().then(async () => {
    while (queued.size) {
      const [next, from] = queued.entries().next().value!;
      queued.delete(next);
      try {
        // Decoded, never MIGRATED: a warm-up writes nothing but its own cache (a first reader's
        // read still performs the lazy representation migration it always has).
        const db = await getDb();
        const row = (await artifactQuery<ArtifactRow>(db, `SELECT * FROM artifacts WHERE id = $1 AND ${LIVE_ARTIFACT_SQL}`, [next])).rows[0];
        if (row?.format === 'markup') await preparedPageFor(row, null, from);
      } catch (error) {
        console.warn('[prepared-page] warm-up failed', next, error);
      }
    }
  }).finally(() => { worker = null; });
}

/** Wait for every queued warm-up (tests; a graceful shutdown). */
export async function drainPreparedPageWarmups(): Promise<void> {
  while (worker) await worker;
}
