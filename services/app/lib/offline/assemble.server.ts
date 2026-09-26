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
 *    included), and the variants run the same engine the same way
 *    (lib/offline/variants);
 *  - threads are the annotation listing's, under its own role rule.
 *
 * Then every server address the file would need is folded in as a `data:`
 * URI (fonts, images, avatars) or, for what cannot travel (a PDF, a file),
 * made an absolute link to its live copy.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listAnnotationsFor, type AnnotationWire } from '@/lib/annotations';
import { archivedReadOnly, archivedVersionForActor, servedRow } from '@/lib/archived-version';
import { canReadArtifact, dataflowForRow, getArtifactById, refDataForRow, viewerIdentityFor, type ArtifactRow, type RoleActor, type TokenActor } from '@/lib/artifacts';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { currentStoryCss } from '@/lib/data/story/story-css.server';
import { getDb } from '@/lib/db';
import { VARIANT_CONTENT_TYPE } from '@/lib/images/optimise';
import type { JsxNode } from '@/lib/jsx';
import { savedMentionStates } from '@/lib/membership';
import { objectStore } from '@/lib/object-store';
import type { StoryIslandData } from '@/lib/story-runtime/contract';
import type { DataflowState } from '@/lib/story/dataflow';
import { loadImage } from '@/lib/story/image-store';
import { prepareStoryParts } from '@/lib/story/prepare-runtime.server';
import { displayTitle } from '@/lib/story/title';
import { getUserById } from '@/lib/users';
import { webAssetByHash, webAssetsForSource } from '@/lib/web-assets';
import { webFontObjectKey } from '@/lib/webfonts';
import { offlineExtrasRef } from './bundle.server';
import { ARTIFACT_FILE_FORMAT, sourceDigest, type ArtifactFile } from './file-format';
import { precomputeVariants, valueDomains, type VariantCaps } from './variants';

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
}

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
const AVATAR_RE = new RegExp(String.raw`/api/users/([A-Za-z0-9_%-]+)/avatar${QUERY}`, 'g');
const WEBFONT_RE = /\/webfonts\/([0-9a-f]{32}\.woff2)/g;
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
 * construction (/assets, /webfonts, /fonts, avatars).
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
    return `${this.origin}${address}`;
  }

  private charge(uri: string): string {
    this.spent += uri.length;
    if (this.spent > this.maxBytes) throw new TooLarge(this.spent);
    return uri;
  }

  private async load(address: string, kind: 'asset' | 'raw' | 'avatar' | 'webfont' | 'font', key: string): Promise<string> {
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
      if (kind === 'webfont') {
        const objectKey = webFontObjectKey(key);
        return objectKey ? this.charge(dataUri('font/woff2', await objectStore().get(objectKey))) : this.absolute(address);
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
    out = await this.replaceAll(out, WEBFONT_RE, 'webfont');
    out = await this.json(out);
    return out.replace(ROOT_URL_RE, (_all, quote: string) => `url(${quote}${this.origin}/`);
  }
}

// ── assembly ────────────────────────────────────────────────────────────────

/**
 * One document, as `actor`, as a complete ArtifactFile — or a refusal the
 * download route turns into its answer. `forbidden` and `not_found` are kept
 * apart here; the route decides whether to show them apart.
 */
export async function assembleArtifactFile(input: AssembleArtifactFileInput): Promise<ArtifactFile | AssembleRefusal> {
  const { actor } = input;
  const origin = input.origin.replace(/\/+$/, '');
  const maxFileBytes = input.maxFileBytes ?? OFFLINE_FILE_MAX_BYTES;
  const artifact = await getArtifactById(input.id);
  if (!artifact) return refuse('not_found', 'This document does not exist.');
  const viewer = actor.userId ? { ...actor, userId: actor.userId, email: actor.email ?? null } : null;
  const admitted = (!!actor.tokenId && actor.tokenId === artifact.token_id) || (await canReadArtifact(artifact, viewer));
  if (!admitted) return refuse('forbidden', 'You do not have access to this document.');
  if (artifact.format !== 'markup') return refuse('not_found', 'Only documents can be downloaded for offline use.');

  const history = tokenActorOf(actor);
  const at = input.version === undefined ? null : await archivedVersionForActor(history, artifact, input.version);
  if (at === 'not_found') return refuse('not_found', `Version ${input.version} of this document is not available to you.`);
  const row: ArtifactRow = await servedRow(artifact, at);
  const source = row.source ?? '';

  const meta = row.meta as { theme?: string | null; template?: string | null; colorMode?: 'light' | 'dark' | null; compiledCss?: string | null; cssCompileVersion?: string | null };
  const design = resolveStoredStoryDesign(meta.theme, meta.colorMode);
  const [compiledCss, refData, ran, readerIdentity, mentionStatuses] = await Promise.all([
    currentStoryCss(meta, row.source),
    // The full copy of every image: the file carries one, inlined.
    refDataForRow(row, { capture: true }),
    dataflowForRow(row, { viewer: actor }),
    viewerIdentityFor(artifact, actor.userId),
    savedMentionStates(artifact),
  ]);
  const parts = await prepareStoryParts({
    source,
    compiledCss,
    theme: design.theme,
    template: meta.template ?? null,
    colorMode: design.colorMode,
    refData,
    assetUrls: await webAssetsForSource(row.source),
    // Declarations only: the rows travel once, in the snapshot, and the file's transport answers from it.
    dataflow: ran ? { flow: ran.flow } : null,
    viewer: readerIdentity,
    title: row.title,
    mentionStatuses,
    ...(at ? { readOnly: archivedReadOnly(at.version) } : {}),
  });
  const island: StoryIslandData = { ...parts.runtime.data, nodes: withoutSrcSets(parts.runtime.data.nodes) };
  // Never a door back to the server: prepareStoryParts was given none, and these are dropped by name besides.
  delete island.queryUrl; delete island.mutateUrl; delete island.assetsUrl; delete island.managedAssets;

  const state = ran?.state ?? EMPTY_STATE;
  const { variants, frozen } = ran
    ? await precomputeVariants({
      flow: ran.flow,
      base: state,
      domains: valueDomains(island.nodes, ran.flow, state),
      caps: input.caps,
      run: async (values, only) => {
        const result = await dataflowForRow(row, { viewer: actor, values, only });
        return { tables: result?.state.tables ?? {}, errors: result?.state.errors ?? {} };
      },
    })
    : { variants: [], frozen: [] };

  // Comments anchor to the CURRENT document; an older version carries none (as its served render offers none).
  const threads: AnnotationWire[] = !at && history ? (await listAnnotationsFor(history, artifact.id, { status: 'all' })) ?? [] : [];

  const imageRefs = new Set(Object.entries(refData).filter(([, r]) => r.kind === 'image').map(([id]) => id));
  const inliner = new Inliner(origin, imageRefs, maxFileBytes);
  const snapshot = { at: new Date().toISOString(), state, variants, frozen };
  let inlined: { css: ArtifactFile['css']; island: StoryIslandData; snapshot: ArtifactFile['snapshot']; threads: AnnotationWire[] };
  try {
    inlined = {
      css: {
        base: await inliner.css(parts.runtime.baseCss),
        compiled: compiledCss ? await inliner.css(compiledCss) : null,
        author: parts.runtime.authorCss ? await inliner.css(parts.runtime.authorCss) : null,
      },
      island: JSON.parse(await inliner.json(JSON.stringify(island))) as StoryIslandData,
      snapshot: JSON.parse(await inliner.json(JSON.stringify(snapshot))) as ArtifactFile['snapshot'],
      threads: JSON.parse(await inliner.json(JSON.stringify(threads))) as AnnotationWire[],
    };
  } catch (error) {
    if (error instanceof TooLarge) return tooLarge(error.bytes);
    throw error;
  }

  const file: ArtifactFile = {
    format: ARTIFACT_FILE_FORMAT,
    origin,
    artifactId: artifact.id,
    liveUrl: `${origin}/a/${artifact.id}`,
    downloadedBy: await downloaderLabel(actor),
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
    bundle: /<Mermaid[\s/>]/.test(source) ? 'mermaid' : 'core',
    extras: await offlineExtrasRef(),
    // The island and stylesheets above were built from exactly this source.
    derivedFrom: sourceDigest(source),
  };
  const bytes = Buffer.byteLength(JSON.stringify(file));
  return bytes > maxFileBytes ? tooLarge(bytes) : file;
}
