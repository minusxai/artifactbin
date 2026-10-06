/**
 * THE SERVER HALF OF THE OFFLINE FILE — one document, as one reader, as one
 * self-contained ArtifactFile (lib/offline/file-format).
 *
 * Every piece comes from the path that already serves it online, so the file
 * can never show more than its downloader could see:
 *  - access is the served document's own decision (canReadArtifact, plus the
 *    token that owns the row), and `version` goes through the archived-version
 *    history check (lib/archived-version);
 *  - the island is prepareStoryParts' — the builder /a/<id>/raw uses — with no
 *    query/mutate/asset endpoints and no live settings, the downloader as
 *    `viewer`;
 *  - the snapshot is dataflowForRow as the downloader (row scoping and `$_me`
 *    included); the imports the downloader may hold travel whole, by the same
 *    rule a reader's page holds them; the variants, for the queries that need
 *    the server, run the same engine the same way (lib/offline/variants);
 *  - threads are the annotation listing's, under its own role rule.
 *
 * Then every server address the file would need is folded in as a `data:`
 * URI (fonts, images, avatars) or, for what cannot travel (a PDF, a file),
 * made an absolute link to its live copy.
 */
import { readFile } from 'node:fs/promises';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import path from 'node:path';
import { listAnnotationsFor, type AnnotationWire } from '@/lib/annotations/store';
import { archivedReadOnly, archivedVersionForActor, servedRow } from '@/lib/serving/archived-version';
import { acceptedMembers, dataflowForRow, dataflowRunsForRow, importsFingerprint, holdableImports, holdImport, nameablePeople, refDataForRow, viewerIdentityFor, type ImportCache } from '@/lib/artifacts/dataflow';
import { canReadArtifact, type ArtifactRow, type RoleActor, type TokenActor } from '@/lib/artifacts/access';
import { getArtifactById, retainDownloadedVersion } from '@/lib/artifacts/store';
import type { ImportTables } from '@/lib/story/data';
import { placeDataflow } from '@/lib/story/data';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { currentStoryCss } from '@/lib/data/story/story-css.server';
import { getDb } from '@/lib/platform/db';
import { PUBLIC_BASE_URL } from '@/lib/platform/config';
import { VARIANT_CONTENT_TYPE } from '@/lib/images/optimise';
import type { JsxNode } from '@/lib/jsx';
import { savedMentionStates } from '@/lib/accounts/membership';
import { isCompileFailure } from '@/lib/compiled-page/contract';
import { loadSsrModule } from '@/lib/compiled-page/bundle.server';
import { withStoredCarriers } from '@/lib/compiled-page/carriers';
import { preparedPageFor } from '@/lib/story/prepared/prepared-page.server';
import { objectStore } from '@/lib/object-store';
import type { StoryIslandData } from '@/lib/story-runtime/contract';
import type { DataflowState } from '@/lib/story/data';
import { loadImage } from '@/lib/story/assets/image-store';
import { prepareStoryParts } from '@/lib/story/prepared/prepare-runtime.server';
import { displayTitle } from '@/lib/story/document';
import { getUserById } from '@/lib/accounts/users';
import { webAssetByHash, webAssetsForSource } from '@/lib/serving/web-assets';
import { offlineExtrasRef } from './bundle.server';
import { ARTIFACT_FILE_FORMAT, sourceDigest, type ArtifactFile } from './file-format';
import { precomputeVariants, valueDomains, type VariantCaps } from './variants';
import { DOCUMENT_UI_FONT_CSS } from '@/lib/serving/app-fonts';
import { withoutUnusedFaces } from './font-faces';
import type { CompiledDataflow } from '@/lib/story/data';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

/** The largest offline file the server will assemble. */
export const OFFLINE_FILE_MAX_BYTES = 25 * 1024 * 1024;

export interface AssembleArtifactFileInput {
  id: string;
  /** The downloader, as the read paths resolve them. */
  actor: RoleActor;
  /** An archived version, admitted only through the history check. */
  version?: number;
  /** Where the file came from, e.g. https://app.artifactbin.dev (no trailing slash needed). */
  origin: string;
  caps?: VariantCaps;
  /** Overrides OFFLINE_FILE_MAX_BYTES (tests trip the cap without a 25 MB fixture). */
  maxFileBytes?: number;
  /** Where each assembly phase's wall time goes (the download route's Server-Timing header). */
  timings?: PhaseTimings;
}

/** Phase name → milliseconds, in the order the phases ran. */
export type PhaseTimings = Map<string, number>;

/** Run `work`, adding its wall time to `phase` in `timings` (when given). */
export async function timed<T>(timings: PhaseTimings | undefined, phase: string, work: () => Promise<T>): Promise<T> {
  if (!timings) return work();
  const started = performance.now();
  try { return await work(); } finally { timings.set(phase, (timings.get(phase) ?? 0) + performance.now() - started); }
}

/** A Server-Timing header value for these phases. */
export const serverTiming = (timings: PhaseTimings): string =>
  [...timings].map(([phase, ms]) => `${phase};dur=${ms.toFixed(1)}`).join(', ');

export interface AssembleRefusal {
  refused: 'not_found' | 'forbidden' | 'too_large';
  message: string;
}

const refuse = (refused: AssembleRefusal['refused'], message: string): AssembleRefusal => ({ refused, message });

const megabytes = (bytes: number): string => `${Math.max(0.1, Math.round((bytes / (1024 * 1024)) * 10) / 10)}`;
const tooLarge = (bytes: number): AssembleRefusal => refuse('too_large',
  `This document is too large to download for offline use (${megabytes(bytes)} MB). Remove large images or open it online.`);

class TooLarge extends Error {
  constructor(readonly bytes: number) { super('too large'); }
}

const EMPTY_STATE: DataflowState = { values: {}, tables: {}, errors: {} };

/** The actor as the history and annotation scopes take it; null with no credential at all. */
function tokenActorOf(actor: RoleActor): TokenActor | null {
  if (actor.userId) return { ...actor, userId: actor.userId, tokenId: actor.tokenId ?? '' };
  return actor.tokenId ? { tokenId: actor.tokenId, userId: null } : null;
}

/** A display label for the top bar — a name or handle, never an email. */
async function downloaderLabel(actor: RoleActor): Promise<string> {
  if (actor.userId) {
    const user = await getUserById(actor.userId);
    if (user) return user.name?.trim() || user.username || 'Signed-in reader';
  }
  return actor.tokenId ? 'Agent' : 'Guest';
}

/** Drop a `srcSet`/`sizes` pair from every element: a file carries one copy of each image, inlined. */
function withoutSrcSets(nodes: JsxNode[]): JsxNode[] {
  return nodes.map((n) => (n.type !== 'element' ? n : {
    ...n,
    attributes: n.attributes.filter((a) => !/^(srcset|sizes)$/i.test(a.name)),
    children: withoutSrcSets(n.children),
  }));
}

// ── inlining ────────────────────────────────────────────────────────────────

const QUERY = String.raw`(?:\?[^\s"'()<>,\\]*)?`;
const ASSET_RE = new RegExp(String.raw`/assets/([0-9a-f]{64})${QUERY}`, 'g');
const RAW_RE = new RegExp(String.raw`/a/([A-Za-z0-9_-]+)/raw${QUERY}`, 'g');
// Consume the canonical origin as well as legacy relative avatar paths; never a foreign URL's suffix.
const avatarOrigin = new URL(PUBLIC_BASE_URL).origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const AVATAR_RE = new RegExp(String.raw`(?<![\w/:.-])(?:${avatarOrigin})?/api/users/([A-Za-z0-9_%-]+)/avatar${QUERY}`, 'g');
const FONT_RE = /\/fonts\/([A-Za-z0-9._-]+\.woff2)/g;
/** Any url() still naming this server, after the known addresses were folded in. */
const ROOT_URL_RE = /url\(\s*(['"]?)\/(?!\/)/g;

const dataUri = (contentType: string, bytes: Buffer): string => `data:${contentType};base64,${bytes.toString('base64')}`;
const widthOf = (address: string): string | null => new URL(address, 'http://x').searchParams.get('w');
const inlinable = (contentType: string): boolean => /^(image|font)\//.test(contentType) || contentType === 'application/font-woff2';

/**
 * Resolves the server addresses in the file's text to `data:` URIs. Each
 * address is loaded once, and only from what the ACL-checked producers above
 * already handed out: `/a/<id>/raw` only for image refs this document's
 * refData resolved for this reader, everything else a public address by
 * construction (/assets, /fonts, avatars).
 */
class Inliner {
  private readonly resolved = new Map<string, string>();
  private spent = 0;

  constructor(
    private readonly origin: string,
    private readonly imageRefs: ReadonlySet<string>,
    private readonly maxBytes: number,
  ) {}

  private absolute(address: string): string {
    return new URL(address, this.origin).href;
  }

  private charge(uri: string): string {
    this.spent += uri.length;
    if (this.spent > this.maxBytes) throw new TooLarge(this.spent);
    return uri;
  }

  private async load(address: string, kind: 'asset' | 'raw' | 'avatar' | 'font', key: string): Promise<string> {
    try {
      if (kind === 'asset') {
        const row = await webAssetByHash(key);
        if (!row) return this.absolute(address);
        const width = widthOf(address);
        const narrow = !!row.small_object_key && width !== null && Number(width) === row.small_width;
        const contentType = narrow ? VARIANT_CONTENT_TYPE : row.content_type;
        if (!inlinable(contentType)) return this.absolute(address);
        return this.charge(dataUri(contentType, await objectStore().get(narrow ? row.small_object_key! : row.object_key)));
      }
      if (kind === 'raw') {
        if (!this.imageRefs.has(key)) return this.absolute(address);
        const image = await getArtifactById(key);
        const stored = image ? await loadImage(image, { width: widthOf(address) }) : null;
        return stored ? this.charge(dataUri(stored.contentType, stored.body)) : this.absolute(address);
      }
      if (kind === 'avatar') {
        const r = await (await getDb()).query<{ image_key: string | null }>('SELECT image_key FROM users WHERE id = $1', [decodeURIComponent(key)]);
        const imageKey = r.rows[0]?.image_key;
        return imageKey ? this.charge(dataUri('image/webp', await objectStore().get(imageKey))) : this.absolute(address);
      }
      // A bundled face: public/fonts, beside the app (server/app serves the same directory).
      return this.charge(dataUri('font/woff2', await readFile(path.join(path.resolve('public'), 'fonts', path.basename(key)))));
    } catch (error) {
      if (error instanceof TooLarge) throw error;
      // Bytes the store will not give: the file keeps a live link rather than failing the download.
      return this.absolute(address);
    }
  }

  private async replaceAll(text: string, re: RegExp, kind: Parameters<Inliner['load']>[1]): Promise<string> {
    const found = new Map<string, string>();
    for (const m of text.matchAll(re)) found.set(m[0], m[1]);
    for (const [address, key] of found) {
      const cacheKey = `${kind}:${address}`;
      if (!this.resolved.has(cacheKey)) this.resolved.set(cacheKey, await this.load(address, kind, key));
    }
    return found.size ? text.replace(re, (address) => this.resolved.get(`${kind}:${address}`) ?? address) : text;
  }

  /** Server addresses inside JSON text (island, snapshot, threads). */
  async json(text: string): Promise<string> {
    let out = await this.replaceAll(text, ASSET_RE, 'asset');
    out = await this.replaceAll(out, RAW_RE, 'raw');
    return this.replaceAll(out, AVATAR_RE, 'avatar');
  }

  /** Font and image addresses inside CSS; anything else root-relative becomes a live link. */
  async css(text: string): Promise<string> {
    let out = await this.replaceAll(text, FONT_RE, 'font');
    out = await this.json(out);
    return out.replace(ROOT_URL_RE, (_all, quote: string) => `url(${quote}${this.origin}/`);
  }
}

// ── precomputed filters, remembered ─────────────────────────────────────────

type Variants = Awaited<ReturnType<typeof precomputeVariants>>;
const VARIANTS_KEPT = 64;
const variantsMemo = new Map<string, Promise<Variants>>();
/**
 * How variants are computed and stored. Bump it when that changes, so every stored set is
 * recomputed rather than served in an old shape.
 */
const VARIANTS_FORMAT = 2;
/** Where computed variants persist, by key: an object-store prefix no route serves (they hold query results). */
export const OFFLINE_VARIANTS_PREFIX = 'offline-variants';

/**
 * What the variants are a function of: the document version served, the downloader's scope, the
 * accepted members, the data of every import (content-addressed, lib/artifacts importsFingerprint),
 * the caps and the queries that need the server. Null when any of it cannot be pinned (a connected
 * database, a query that reads the clock), so those documents recompute every time.
 */
async function variantsKey(artifact: ArtifactRow, version: number, row: ArtifactRow, flow: CompiledDataflow, actor: RoleActor, caps: VariantCaps | undefined, queries: ReadonlySet<string>): Promise<string | null> {
  if (flow.queries.some((q) => q.params.includes('_now'))) return null;
  const data = await importsFingerprint(row, flow);
  if (data === null) return null;
  const members = JSON.stringify(await acceptedMembers(artifact.id));
  return createHash('sha256').update(JSON.stringify([VARIANTS_FORMAT, artifact.id, version, artifact.edit_id, actor.userId ?? null, actor.tokenId ? 1 : 0, members, data, caps ?? null, [...queries].sort()])).digest('hex');
}

/** A stored set, or null when there is none (or it cannot be read: then it is computed again). */
async function storedVariants(key: string): Promise<Variants | null> {
  try { return JSON.parse(gunzipSync(await objectStore().get(`${OFFLINE_VARIANTS_PREFIX}/${key}`)).toString('utf8')) as Variants; }
  catch { return null; }
}

/**
 * The variants for `key`: this process's copy, else the object store's (it survives deploys and
 * restarts and every instance shares it), else computed once — concurrent downloads share the run
 * — and stored. An uncacheable key computes every time.
 */
function cachedVariants({ key, compute }: { key: string | null; compute: () => Promise<Variants> }): Promise<Variants> {
  if (!key) return compute();
  const known = variantsMemo.get(key);
  if (known) return known;
  const made = (async () => {
    const stored = await storedVariants(key);
    if (stored) return stored;
    const computed = await compute();
    // A store that will not take it costs the next process one computation, never this download.
    await objectStore().put(`${OFFLINE_VARIANTS_PREFIX}/${key}`, gzipSync(JSON.stringify(computed)), 'application/gzip').catch(() => {});
    return computed;
  })();
  variantsMemo.set(key, made);
  if (variantsMemo.size > VARIANTS_KEPT) variantsMemo.delete(variantsMemo.keys().next().value!);
  // A failed run is not remembered: the next download tries again.
  made.catch(() => { if (variantsMemo.get(key) === made) variantsMemo.delete(key); });
  return made;
}

// ── assembly ────────────────────────────────────────────────────────────────

/**
 * One document, as `actor`, as a complete ArtifactFile — or a refusal the
 * download route turns into its answer. `forbidden` and `not_found` are kept
 * apart here; the route decides whether to show them apart.
 */
export async function assembleArtifactFile(input: AssembleArtifactFileInput): Promise<ArtifactFile | AssembleRefusal> {
  const { actor, timings } = input;
  const origin = input.origin.replace(/\/+$/, '');
  const maxFileBytes = input.maxFileBytes ?? OFFLINE_FILE_MAX_BYTES;
  const artifact = await timed(timings, 'access', () => getArtifactById(input.id));
  if (!artifact) return refuse('not_found', 'This document does not exist.');
  const viewer = actor.userId ? { ...actor, userId: actor.userId, email: actor.email ?? null } : null;
  const admitted = (!!actor.tokenId && actor.tokenId === artifact.token_id) || (await timed(timings, 'access', () => canReadArtifact(artifact, viewer)));
  if (!admitted) return refuse('forbidden', 'You do not have access to this document.');
  if (artifact.format !== 'markup') return refuse('not_found', 'Only documents can be downloaded for offline use.');

  // Only an admitted live server snapshot can become a download checkpoint.
  if (input.version === undefined) await retainDownloadedVersion(artifact);

  const history = tokenActorOf(actor);
  const at = input.version === undefined ? null : await archivedVersionForActor(history, artifact, input.version);
  if (at === 'not_found') return refuse('not_found', `Version ${input.version} of this document is not available to you.`);
  const row: ArtifactRow = await servedRow(artifact, at);
  const source = row.source ?? '';
  const { page } = await timed(timings, 'page', () => preparedPageFor(artifact, at));
  // A page compiled under the current contract pins no runtime: the file pins the build serving it now
  // (its SSR half is read live and its chunk graph is the server's, so both are left out of the file).
  const { ssr: _liveSsr, graph: _liveGraph, ...liveBuild } = loadCompilerBuild();
  const compiled = page.compiled && !isCompileFailure(page.compiled) ? { ...page.compiled, sharedBuild: page.compiled.sharedBuild ?? liveBuild } : null;
  if (!compiled) throw new Error(`offline file: compiled page unavailable for ${artifact.id}`);

  const meta = row.meta as { theme?: string | null; template?: string | null; colorMode?: 'light' | 'dark' | null; compiledCss?: string | null; cssCompileVersion?: string | null };
  const design = resolveStoredStoryDesign(meta.theme, meta.colorMode);
  const [compiledCss, refData, ran, readerIdentity, mentionStatuses] = await timed(timings, 'run', () => Promise.all([
    currentStoryCss(meta, row.source),
    // The full copy of every image: the file carries one, inlined.
    refDataForRow(row, { capture: true }),
    dataflowForRow(row, { viewer: actor }),
    viewerIdentityFor(artifact, actor.userId),
    savedMentionStates(artifact),
  ]));
  /*
   * WHAT THE FILE CAN RUN ITSELF: every import the downloader may hold travels
   * whole, decided by the same rule and the same door check as a reader's page
   * (lib/artifacts holdableImports), and the file's own SQLite engine runs
   * every query over them live. Only the rest — a connected database, data
   * the downloader may not hold — is precomputed below.
   */
  const held: Record<string, ImportTables[string]> = {};
  await timed(timings, 'hold', async () => {
    const hold = ran ? await holdableImports(row, ran.flow, actor) : [];
    for (const name of hold) {
      const tables = await holdImport(row, name, actor);
      if (tables) held[name] = tables;
    }
  });
  const parts = await timed(timings, 'island', async () => prepareStoryParts({
    source,
    compiledCss,
    theme: design.theme,
    template: meta.template ?? null,
    colorMode: design.colorMode,
    refData,
    assetUrls: await webAssetsForSource(row.source),
    // Declarations only: the rows travel once, in the snapshot, and the file answers from it.
    dataflow: ran ? { flow: ran.flow, hold: Object.keys(held) } : null,
    viewer: readerIdentity,
    title: row.title,
    mentionStatuses,
    ...(at ? { readOnly: archivedReadOnly(at.version) } : {}),
  }));
  const island: StoryIslandData = { ...parts.runtime.data, nodes: withoutSrcSets(parts.runtime.data.nodes) };
  // Never a door back to the server: prepareStoryParts was given none, and these are dropped by name besides.
  delete island.queryUrl; delete island.mutateUrl; delete island.assetsUrl;
  // The file carries its engine's wasm inside its code (lib/offline/compiled-sqlite), never a server address.
  delete island.sqliteWasm;

  /*
   * WHO THE FILE MAY NAME. Its own runs show people no server run named, and
   * it can ask no door later, so it carries every card a reader's page could
   * ask its door for (lib/artifacts nameablePeople, for the downloader); the
   * run's own cards stand beside them.
   */
  const named = Object.keys(held).length ? await timed(timings, 'people', () => nameablePeople(row, actor)) : {};
  const state = ran ? { ...ran.state, ...(Object.keys(named).length ? { people: { ...named, ...ran.state.people } } : {}) } : EMPTY_STATE;
  let renderedCompiled = compiled;
  if (compiled.ssr) {
    const ssr = compiled.ssr;
    const ssrHtml = (await timed(timings, 'ssr', () => loadSsrModule(ssr, undefined, undefined, page.compiled && !isCompileFailure(page.compiled) ? page.compiled.sharedBuild?.ssr : undefined))).render({
      values: state.values, state, results: state, mermaidImages: {}, drawings: {},
    });
    // A fresh per-request render never carries the compiled module's own island
    // literals (read by DOM lookup) or its large-constants module-data carrier
    // (which file-html.ts retags for `getElementById`): the stored render's, as
    // assembleReaderPage takes them online.
    renderedCompiled = { ...compiled, html: withStoredCarriers(ssrHtml, compiled.html) };
  }
  const placement = ran ? placeDataflow(ran.flow, Object.keys(held)) : null;
  const serverQueries = new Set(Object.entries(placement?.queries ?? {}).filter(([, where]) => where === 'server').map(([name]) => name));
  const importCache: ImportCache = new Map();
  const { variants, frozen } = ran
    ? await timed(timings, 'variants', async () => cachedVariants({
      key: await variantsKey(artifact, at?.version ?? artifact.version, row, ran.flow, actor, input.caps, serverQueries),
      compute: () => precomputeVariants({
        flow: ran.flow,
        base: state,
        domains: valueDomains(island.nodes, ran.flow, state, serverQueries),
        queries: serverQueries,
        caps: input.caps,
        run: (runs) => dataflowRunsForRow(row, { viewer: actor, importCache }, runs),
      }),
    }))
    : { variants: [], frozen: [] };

  // Comments anchor to the CURRENT document; an older version carries none (as its served render offers none).
  const threads: AnnotationWire[] = !at && history ? (await timed(timings, 'threads', () => listAnnotationsFor(history, artifact.id, { status: 'all' }))) ?? [] : [];

  const imageRefs = new Set(Object.entries(refData).filter(([, r]) => r.kind === 'image').map(([id]) => id));
  const inliner = new Inliner(origin, imageRefs, maxFileBytes);
  const snapshot = { at: new Date().toISOString(), state, held, variants, frozen };
  let inlined: { css: ArtifactFile['css']; island: StoryIslandData; compiled: NonNullable<ArtifactFile['compiled']>; snapshot: ArtifactFile['snapshot']; threads: AnnotationWire[] };
  // Everything the file can draw: the font subsets no character of it reaches are left out (lib/offline/font-faces).
  const downloadedBy = await downloaderLabel(actor);
  const text = [source, row.title ?? '', downloadedBy, JSON.stringify(snapshot), JSON.stringify(threads)].join('\n');
  const css = (sheet: string) => inliner.css(withoutUnusedFaces(sheet, text));
  try {
    inlined = await timed(timings, 'inline', async () => ({
      css: {
        base: await css(parts.runtime.baseCss + '\n' + DOCUMENT_UI_FONT_CSS),
        compiled: compiledCss ? await css(compiledCss) : null,
        author: parts.runtime.authorCss ? await css(parts.runtime.authorCss) : null,
      },
      island: JSON.parse(await inliner.json(JSON.stringify(island))) as StoryIslandData,
      compiled: JSON.parse(await inliner.json(JSON.stringify(renderedCompiled))) as NonNullable<ArtifactFile['compiled']>,
      snapshot: JSON.parse(await inliner.json(JSON.stringify(snapshot))) as ArtifactFile['snapshot'],
      threads: JSON.parse(await inliner.json(JSON.stringify(threads))) as AnnotationWire[],
    }));
  } catch (error) {
    if (error instanceof TooLarge) return tooLarge(error.bytes);
    throw error;
  }

  const file: ArtifactFile = {
    format: ARTIFACT_FILE_FORMAT,
    origin,
    artifactId: artifact.id,
    liveUrl: `${origin}/a/${artifact.id}`,
    downloadedBy,
    downloadedAt: new Date().toISOString(),
    // An archived version's edit id is not recorded, so a sync merges from its source rather than fast-forwarding.
    base: { version: at ? at.version : artifact.version, editId: at ? '' : artifact.edit_id, source },
    source,
    metadata: {
      title: displayTitle(row),
      description: row.description ?? null,
      theme: design.theme,
      template: meta.template ?? null,
      colorMode: design.colorMode,
    },
    ...inlined,
    journal: [],
    localIds: [],
    bundle: 'solid',
    compiledFlowDigest: sourceDigest(JSON.stringify(island.dataflow?.flow ?? null)),
    extras: await offlineExtrasRef(),
    // The island and stylesheets above were built from exactly this source.
    derivedFrom: sourceDigest(source),
  };
  const bytes = Buffer.byteLength(JSON.stringify(file));
  return bytes > maxFileBytes ? tooLarge(bytes) : file;
}
