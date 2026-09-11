import type {MutationReceipt} from './mutation-receipt';
import {parseSharingEntries} from '@artifactbin/utils';
import type {RefLoader} from '@/lib/story/refs';
import {creationOperation,lookupCreation,CreationReplay} from '@/lib/creation-ledger';
import {artifactState} from '@/lib/artifact-state';
import {prepareContentInput,applyPreparedContent,type PreparedContent} from '@/lib/story/prepare-content';
import {parseAnnotationOperations} from './story/annotation-edits';
import { notifyRemoteComment } from './remote/mentions';
import {prepareCatalog,catalogOf} from '@/lib/datasets/catalog';
import {DatasetError} from '@/lib/datasets/errors';
/**
 * The wire ↔ storage translation for one artifact: what a read echoes, how a
 * write body is validated, and the replace pipeline both write paths run.
 *
 * It lives in lib because BOTH auth modes need it — the bearer routes under
 * /api/artifacts and the cookie routes under /api/my/artifacts. A route
 * importing another route's exports makes one handler the library of the
 * other, with no way to tell which behaviour is shared on purpose; here the
 * shared behaviour is the module, so both paths validate the same fields and
 * answer with the same shape (`edit_id` and refresh `warnings` included).
 */
import {
  DATASET_ACCESS, SHARE_ROLES, artifactQuotaExceeded, byteQuotaFor, canWriteDataset, createArtifact, fontResolver, findDependentsFor, getArtifactFor, getOwnedArtifactFor, assetImporterFor, isVersionConflict, refLoaderForActor, refreshWarningsFor, replaceArtifactFor, setMetadataFor, writerFor,
  type ArtifactInput, type ArtifactRow, type ArtifactSummary, type DatasetAccess, type EditInput, type EditOutcome, type ReplaceOpts, type ShareEntry, type ShareRole, type TokenActor, type Visibility,
} from '@/lib/artifacts';
import { actOnAnnotationFor, annotationsWireForRow, countOpenAnnotations, type AnnotationAction, type AnnotationAuthor } from '@/lib/annotations';
import { hasAmbiguousLegacyAliases, stampNodeIds } from '@/lib/story/node-ids';
import { isMutationRefused, mutateDataset } from '@/lib/story/dataset-mutate';
import type { SourceRepair } from '@/lib/jsx/repair';
import type { Scalar } from '@/lib/story/dataflow';
import { datasetCreateFields } from '@/lib/story/dataset-usage';
import { imageRawUrl, pdfRawUrl } from '@/lib/story/ref-data';
import { ALLOW_PUBLIC_VISIBILITY } from '@/lib/config';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { json, readJson } from '@/lib/http';
import { ID_RE } from '@/lib/ids-shape';
import { PARENT_REFUSED, isParentRefusal, parentOf, resolveParent } from '@/lib/folders';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { CONTENT_FIELDS } from '@/lib/story/input';
import { collectExternalAssetUrls } from '@/lib/story/external-images';
import type { AssetWarning } from '@/lib/web-assets';
import { refreshWebAssets, type WebAssetImporter } from '@/lib/web-assets';
import { getDb } from '@/lib/db';

const safeJson = (s: string): unknown => { try { return JSON.parse(s); } catch { return null; } };

/**
 * A list is an index, never a bulk read. Keep the projection explicit at the
 * wire boundary so adding a storage column cannot silently send it to every
 * caller. Even `meta` is narrowed: compiled CSS, image placeholders and
 * object-store keys belong to an individual artifact read, not discovery.
 */
const SUMMARY_META_FIELDS = {
  markup: ['theme', 'template', 'colorMode', 'refs'],
  dataset: ['columns', 'rowCount', 'totalRows', 'truncated'],
  viz: ['slots'],
  image: ['contentType', 'bytes', 'width', 'height'],
  // A PDF's listing card says how big it is and how long — the two facts a
  // reader picks between files by. The object key stays out, like every other
  // tier's.
  pdf: ['contentType', 'bytes', 'pages'],
  file: ['contentType', 'bytes', 'filename'],
  // A folder's meta carries only the sheet its scaffold compiled to, which is
  // an individual read's business. Present so the lookup is total over
  // ArtifactFormat rather than falling through to the `?? []`.
  folder: [],
} as const;

function summaryMeta(format: ArtifactRow['format'], meta: Record<string, unknown>) {
  const fields = SUMMARY_META_FIELDS[format] ?? [];
  return Object.fromEntries(fields.flatMap((key) => key in meta ? [[key, meta[key]]] : []));
}

export function artifactSummaryToWire(
  row: ArtifactSummary & { views?: number; sparkline?: string },
  base: string,
) {
  return {
    id: row.id,
    url: `${base}/a/${row.id}`,
    title: row.title,
    description: row.description,
    format: row.format,
    version: row.version,
    visibility: row.visibility,
    ...(row.access ? { access: row.access } : {}),
    /*
     * PLACEMENT, both halves. `parent_id` is what a client WRITES back (an
     * agent holds a folder's id and nothing else), and `ancestor_ids` is the
     * whole trail, so breadcrumbs are drawn from one read rather than a walk
     * up the tree. Both are derived from the one stored array — lib/folders is
     * the only module that does arithmetic on it.
     */
    parent_id: parentOf(row),
    ancestor_ids: row.ancestor_ids ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    meta: summaryMeta(row.format, row.meta),
    ...(typeof row.views === 'number' ? { views: row.views } : {}),
    ...(typeof row.sparkline === 'string' ? { sparkline: row.sparkline } : {}),
  };
}

/**
 * The artifact GET's shape: the wire row plus the OPEN annotations inlined,
 * anchors in current coordinates. This is where "colocation" lives — the read
 * an agent already makes before editing carries the owner's feedback, so no
 * second call and no second concept exist on the read side.
 */
export async function artifactToWireWithAnnotations(row: ArtifactRow, base: string) {
  const wire = await artifactToWire(row, base);
  return row.format === 'markup' || row.format === 'folder' ? { ...wire, annotations: await annotationsWireForRow(row) } : wire;
}

/**
 * The write echo, priced.
 *
 * Stored markup is CANONICAL — a `<p>` holding a block becomes a `<div>`, a
 * `<Helmet>` is hoisted — so an agent must edit against what was STORED, not
 * what it sent. That is why every write echoes the document. But when
 * canonicalization changed nothing, the echo is the caller's own bytes handed
 * straight back, and it is not free: it lands in the agent's context and is
 * replayed on every later turn (~3.5k tokens per write on a deck, fifteen
 * write attempts in one measured run).
 *
 * So the field is present exactly when it is NEWS, and `markup_changed` names
 * which case it is — an absent field alone would be ambiguous between "same as
 * you sent" and "this response has no markup".
 *
 * A caller that sent no markup (a dataset write, a metadata-only PUT) is
 * unchanged: there is nothing to compare, so the echo rides as before.
 */
function markupEcho(sent: unknown, stored: string | null): Record<string, unknown> {
  if (typeof sent !== 'string') return { markup: stored };
  return sent === stored ? { markup_changed: false } : { markup_changed: true, markup: stored };
}

/**
 * ASSET WARNINGS ride their own key.
 *
 * `warnings` already meant something on a write reply — the dependent
 * documents a dataset write broke, `{id, title, details}` — and an external URL
 * that would not import is `{code, url, fix}`. Both can be true of one markup
 * PUT, and one key holding two shapes is a wire nobody can parse: a caller
 * would have to sniff each element to know what it is reading. So the asset
 * half is `asset_warnings`, present only when there is something to say.
 */
export const assetWarningsEcho = (warnings: AssetWarning[] | undefined): Record<string, unknown> =>
  (warnings?.length ? { asset_warnings: warnings } : {});

/**
 * SOURCE REPAIRS ride their own key too, for the same reason and one more.
 *
 * A repair is not a warning: nothing is missing and nothing needs fixing — the
 * door already changed the document and it published. What the caller needs is
 * to know WHAT was changed, because the source it reads back will not be the
 * source it sent. That is the whole licence for repairing an agent's markup
 * instead of refusing it (lib/jsx/repair), so this key is the contract, not a
 * courtesy. Present only when something was repaired.
 */
export const sourceRepairsEcho = (repairs: SourceRepair[] | undefined): Record<string, unknown> =>
  (repairs?.length ? { source_repairs: repairs } : {});

/** Full wire shape for a single-artifact read. */
export async function artifactToWire(row: ArtifactRow, base: string) {
  // `deleted_at` is dropped with the ownership columns: the trash gate means a
  // row a caller can read is always live, so the field could only ever echo
  // null — a key in every agent's context that can carry no news.
  const { content, source, token_id: _token, user_id: _owner, deleted_at: _trashed, meta, format, ...rest } = row;
  const m = meta as { theme?: string; template?: string; colorMode?: 'light' | 'dark' | null };
  // Echo the LIVE vocabulary: a stored retired theme reads back as its
  // successor, so an agent that read-before-writes never learns a name that
  // publish would reject.
  const design = resolveStoredStoryDesign(m.theme, m.colorMode ?? null);
  // A FOLDER is a markup document whose source we wrote — it reads back, edits,
  // comments and echoes exactly like one.
  const isDoc = format === 'markup' || format === 'folder';
  return {
    ...rest,
    state: artifactState(row),
    format,
    url: `${base}/a/${row.id}`,
    // The trail rides in `...rest`; the parent is derived from it, and it is
    // the half a caller writes back.
    parent_id: parentOf(row),
    markup: source,
    // Annotations are sidecar state (lib/annotations) — the write path never
    // round-trips them, so every echo carries the open COUNT as the signal;
    // the artifact GET additionally inlines the full open set.
    ...(isDoc ? { open_annotations: await countOpenAnnotations(row.id) } : {}),
    // markup (story-engine) tier only: the source IS the artifact;
    // template/colorMode ride meta.
    ...(isDoc
      ? {
          template: m.template ?? null,
          colorMode: design.colorMode,
          refs: (meta as { refs?: unknown }).refs ?? [],
        }
      : {}),
    theme: design.theme,
    ...(format === 'dataset'
      ? {
          // The write ACL, beside the read one — an agent has to know before
          // it publishes a <Mutation> naming this dataset.
          access: row.access,
          ...(catalogOf(row)?{meta:{catalog:catalogOf(row)}}:{}),
          columns: (meta as { columns?: unknown }).columns ?? [],
          rowCount: (meta as { rowCount?: unknown }).rowCount ?? 0,
          ...(meta as { totalRows?: number; truncated?: boolean }).truncated
            ? { totalRows: (meta as { totalRows?: number }).totalRows, truncated: true } : {},
          // The rows themselves, from wherever they live. The editor resolves
          // refs client-side through this endpoint, and reading them out of
          // `content` stopped working when rows moved to the object store —
          // every chart in edit mode said "data unavailable".
          rows: await loadDatasetRows(row),
        }
      : {}),
    ...(format === 'viz' ? { slots: (meta as { slots?: unknown }).slots ?? [], recipe: safeJson(content) } : {}),
    ...(format === 'image' ? { contentType: (meta as { contentType?: unknown }).contentType ?? null } : {}),
    ...(format === 'file' ? { filename: (meta as { filename?: string }).filename, contentType: (meta as { contentType?: string }).contentType, bytes: (meta as { bytes?: number }).bytes } : {}),
    ...(format === 'pdf' ? { contentType: (meta as { contentType?: unknown }).contentType ?? null, bytes: (meta as { bytes?: unknown }).bytes ?? 0, pages: (meta as { pages?: unknown }).pages ?? null } : {}),
  };
}

/** Every conditional HTTP write carries the observed state; replacements also carry its version. */
export function parseExpectedVersion(body: Record<string, unknown>, requireVersion=true): ReplaceOpts | Response {
  const v = body.expectedVersion;
  const state = body.expectedState;
  if (v !== undefined && !(typeof v === 'number' && Number.isSafeInteger(v) && v > 0)) return json({error:'invalid_expected_version'},400);
  if (state !== undefined && (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state))) return json({error:'invalid_expected_state'},400);
  if (requireVersion && v === undefined) return json({error:'version_required',hint:'Read the artifact and send its version as expectedVersion.'},400);
  if (state === undefined) return json({error:'state_required',hint:'Read the artifact and send its state as expectedState.'},400);
  return {...(v !== undefined ? {expectedVersion:v as number} : {}),expectedState:state as string};
}

/**
 * The wire's `parent_id`: the id of a folder artifact, or null for the root.
 * ABSENT is "leave it where it is"; NULL is "move it to the root", and the two
 * must stay distinguishable, which is why this answers `undefined` rather than
 * folding an absent field into null.
 *
 * It never READS the parent row — that is `lib/folders resolveParent`, and it
 * runs only after the ownership scope has resolved the row being written. A
 * shape check may run first; a database read may not, or an id nobody can
 * reach answers 400 where it owes the uniform 404.
 *
 * `folder` was a materialized PATH of names and is answered BY NAME, the same
 * shape the retired `markdown`/`html` inputs use: an agent sending the old
 * field learns what replaced it instead of reading "invalid".
 */
export function parseParentField(body: Record<string, unknown>): string | null | undefined | Response {
  if (body.folder !== undefined && body.folder !== null) {
    return json({
      error: 'folder_retired',
      hint: "send parent_id: the id of a folder artifact (create one with format: 'folder')",
    }, 400);
  }
  const p = body.parent_id;
  if (p === undefined) return undefined;
  if (p === null) return null;
  if (typeof p !== 'string' || !ID_RE.test(p)) return json({ error: 'invalid_parent' }, 400);
  return p;
}

/** Validate a raw visibility value (a body field OR a query param). */
export function parseVisibilityValue(v: unknown, canPrivate: boolean): Visibility | undefined | Response {
  if (v === undefined || v === null || v === '') return undefined;
  if (v !== 'public' && v !== 'private' && v !== 'unlisted') return json({ error: 'invalid_visibility' }, 400);
  // Only 'private' needs an account to anchor its ACL — 'unlisted' reads like
  // public, so an anonymous doc may be unlisted.
  if (v === 'private' && !canPrivate) return json({ error: 'private_requires_account' }, 400);
  /*
   * `public` is a setting a DEPLOYMENT opens (`ARTIFACTS__ALLOW_PUBLIC=1`);
   * closed, it is refused BY NAME rather than quietly written as something
   * else, exactly like `private` without an account. An agent that asked for
   * public and silently got `unlisted` would hand its user a link believing
   * something untrue about who can find the document.
   */
  if (v === 'public' && !ALLOW_PUBLIC_VISIBILITY) {
    return json({ error: 'public_not_enabled', hint: 'this deployment has not enabled public documents (ARTIFACTS__ALLOW_PUBLIC=1); use "unlisted", which is already anyone-with-the-link' }, 400);
  }
  return v;
}

/**
 * The optional `linkRole` body field — GENERAL ACCESS: what the link grants
 * whoever holds the address. Absent ⇒ undefined (keep the current value; a row
 * that has never been set reads as `viewer`).
 *
 * Accepted while `private`, deliberately: visibility gates it at read time
 * (lib/artifacts linkRoleOf), so storing it there costs nothing and means a
 * trip through `private` and back RESTORES the owner's choice rather than
 * silently resetting it to `viewer`. Refusing it would make the dialog's two
 * controls order-dependent, which is exactly the kind of rule nobody remembers.
 */
export function parseLinkRoleValue(v: unknown): ShareRole | undefined | Response {
  if (v === undefined || v === null || v === '') return undefined;
  if (!SHARE_ROLES.includes(v as ShareRole)) {
    return json({ error: 'invalid_link_role', allowed: [...SHARE_ROLES] }, 400);
  }
  return v as ShareRole;
}

/**
 * The optional `access` body field — the WRITE ACL, datasets only. Absent ⇒
 * undefined (create defaults to 'read', PUT keeps the current value). Asking
 * for it on a document/image/recipe is a 400 rather than a silent drop: there
 * is nothing to write there, and accepting the field would teach an agent a
 * knob that does nothing.
 */
export function parseAccessValue(v: unknown, format: string | undefined): DatasetAccess | undefined | Response {
  if (v === undefined || v === null || v === '') return undefined;
  if (!DATASET_ACCESS.includes(v as DatasetAccess)) {
    return json({ error: 'invalid_access', allowed: [...DATASET_ACCESS] }, 400);
  }
  if (format !== undefined && format !== 'dataset') {
    return json({ error: 'access_datasets_only', details: [`access is the write ACL of a dataset — a ${format} artifact has no rows to write`] }, 400);
  }
  return v as DatasetAccess;
}

/** Typed sharing is shared with the CLI; absent preserves and [] clears. */
export function parseShareEntries(v:unknown):ShareEntry[]|undefined|Response{
 try{return parseSharingEntries(v);}catch(error){return json({error:'invalid_shares',detail:error instanceof Error?error.message:'Invalid sharing entries'},400);}
}

function parseAccessField(body: Record<string, unknown>, format: string | undefined): DatasetAccess | undefined | Response {
  return parseAccessValue(body.access, format);
}

function parseVisibility(body: Record<string, unknown>, canPrivate: boolean): Visibility | undefined | Response {
  return parseVisibilityValue(body.visibility, canPrivate);
}

/**
 * The full-replace pipeline both PUT routes run: read the body, validate the
 * content and the metadata fields, write inside one transaction, and answer.
 *
 * The actor decides scope AND whether `private` is even expressible — a token
 * claimed by an account stamps its artifacts with that account, so the actor's
 * userId IS the row's owner and no extra read is needed.
 */
export async function replaceArtifactFromRequest(
  request: Request,
  actor: TokenActor,
  id: string,
  base: string,
): Promise<Response> {
  const body = await readJson(request);
  return replaceArtifactWithBody(body, actor, id, base);
}

/** The same pipeline with the body already in hand — what the operations registry calls. */
export async function replaceArtifactWithBody(
  body: Record<string, unknown> | null,
  actor: TokenActor,
  id: string,
  base: string,
  options: {dryRun?:boolean; loadRef?:RefLoader} = {},
): Promise<Response> {
  if (!body) return json({ error: 'invalid_json' }, 400);
  // The row FIRST: refs and imports resolve as the DOCUMENT's owner, never as
  // the writer — an editor (artifact_shares.role) replacing a document that
  // carries its owner's <Mutation> or private image must not fail on assets
  // they could never own. Unreachable is the uniform 404, before any parse.
  const current = await getArtifactFor(actor, id);
  if (!current) return json({ error: 'not_found' }, 404);
  // Sharing settings use edit access; filing under an owner's folder still checks placement.
  const owned = body.parent_id !== undefined ? await getOwnedArtifactFor(actor, id) : null;
  const owner = writerFor(current);
  const sentMarkup = body.markup;
  const annotationOps=body.annotation_ops===undefined?[]:parseAnnotationOperations(body.annotation_ops);
  if(!annotationOps||annotationOps.length&&typeof sentMarkup!=='string')return json({error:'invalid_annotation_operations'},400);
  const expected = parseExpectedVersion(body);
  if (expected instanceof Response) return expected;
  let normalizeMarkup: ((source: string) => string) | undefined;
  if(typeof body.markup==='string') {
    if(hasAmbiguousLegacyAliases(body.markup)) return json({error:'ambiguous_node_alias'},409);
    const db=await getDb();
    const lifetime=await db.query<{source_id:string}>('SELECT source_id FROM artifact_source_ids WHERE artifact_id=$1',[current.id]);
    normalizeMarkup = source => stampNodeIds(source,{previousSource:current.source,reservedIds:lifetime.rows.map(row=>row.source_id),retireLegacyAliases:false}).source;
  }
  /*
   * A FOLDER HAS NO CONTENT, AND THE REPLACE DOOR IS WHERE THAT IS ENFORCED.
   *
   * Measured on main before this: a plain `PUT {markup}` on a folder answered
   * 200 and rewrote `format` to `'markup'` — which orphaned every child (their
   * `ancestor_ids` still named a row that was no longer a folder), took the row
   * out of the shelf's `folders` partition, and made the id permanently
   * unusable as a `parent_id` (`resolveParent` refuses a non-folder). One
   * `update_artifact` destroyed the folder, irreversibly as far as any door
   * here is concerned.
   *
   * So the row's format is the truth and the body may not change it. Content
   * is refused BY NAME with the code the data tiers already answer — a folder
   * is a place, and `not_editable` is exactly what it means — and the METADATA
   * a folder does have (title, visibility, placement) still goes through, which
   * is how an agent renames one without a second door to learn.
   *
   * Above `parseContentInput` deliberately, for the reason the governance check
   * above gives: that parse FETCHES, and a refused write must not import the
   * caller's images on the way to being refused.
   */
  if (current.format === 'folder') {
    if (CONTENT_FIELDS.some((f) => body[f] !== undefined)) {
      return json({ error: 'not_editable', details: ['a folder has no content — its page is its listing. Send title, visibility or parent_id instead'] }, 400);
    }
  }
  const prepared: PreparedContent | Response = current.format === 'folder'
    ? {content: { format: 'folder', content: '', source: '', meta: {}, derivedTitle: null }, objects: []}
    : await prepareContentInput({theme:current.meta.theme,template:current.meta.template,colorMode:current.meta.colorMode,...body}, {
      prepareDataset: (input,objects) => prepareCatalog(input,actor,current,objects),
      normalizeMarkup,
      loadRef: options.loadRef ?? refLoaderForActor(owner),
      overByteQuota: byteQuotaFor(owner.tokenId),
    }, {allowRemoteInputs:!options.dryRun});
  if (prepared instanceof Response) return prepared;
  let parsed = prepared.content;

  const visibility = parseVisibility(body, !!actor.userId);
  if (visibility instanceof Response) return visibility;
  const parent = parseParentField(body);
  if (parent instanceof Response) return parent;
  const access = parseAccessField(body, parsed.format);
  if (access instanceof Response) return access;
  if(access==='readwrite'&&catalogOf(parsed)?.kind==='postgres')return json({error:'dataset_read_only',details:['Postgres datasets are read-only']},400);
  const shares=parseShareEntries(body.shares);if(shares instanceof Response)return shares;
  if(body.visibility===null||body.linkRole===null)return json({error:'invalid_metadata',hint:'visibility and linkRole cannot be null.'},400);
  const link=parseLinkRoleValue(body.linkRole);if(link instanceof Response)return link;
  /*
   * PLACEMENT IS RESOLVED HERE, AFTER the scope answered `current` above — a
   * row this caller cannot reach is the uniform 404 whatever the body says,
   * and validating the parent first would answer 400 for an id that does not
   * exist for them, which is an existence oracle.
   *
   * …and it is the OWNER's verb, which this door alone has to say out loud:
   * the replace scope is `editorScope`, so a named editor reaches this line,
   * while every other way to move a row (the PATCH) is owner-scoped and
   * refuses them with the uniform 404 before a parent is ever looked at. An
   * editor may rewrite the document; filing it — into a folder of the owner's,
   * or out to the root — is not theirs to do (lib/artifacts ownerScope: "delete,
   * sharing, folder, dataset access, listing"). PLACEMENT only: `visibility` and
   * `access` above are on `canGovern`'s list too and this door has always let an
   * editor set them — refused above, on the same one ownership read this
   * shares. The read is what asks, so the ONE ownership rule stays
   * in SQL rather than being mirrored in JS here, and it is paid for only when
   * a placement or a governance field was actually asked for. The refusal is `invalid_parent`, which
   * already conflates "not a folder you may file into" — there is no second
   * code to learn, and it says nothing about whether the parent exists.
   */
  const mayPlace = parent === undefined || !!owned;
  const placement = parent === undefined ? undefined
    : mayPlace ? await resolveParent(writerFor(current), parent, { id: current.id, format: current.format })
      : PARENT_REFUSED;
  if (placement && isParentRefusal(placement)) return json(placement, 400);

  if (expected.expectedVersion !== undefined && expected.expectedVersion !== current.version || expected.expectedState !== undefined && expected.expectedState !== artifactState(current)) {
    return json({error:expected.expectedVersion !== undefined && expected.expectedVersion !== current.version?'version_conflict':'state_conflict',currentVersion:current.version,currentState:artifactState(current)},409);
  }
  if (options.dryRun) return preflightReply(prepared);

  const applied = await applyPreparedContent(prepared, {importAsset: assetImporterFor(owner.tokenId, owner.userId), resolveFont: fontResolver()});
  if (applied instanceof Response) return applied;
  parsed = applied;
  const input: ArtifactInput = {
    ...parsed,
    ...(body.title===null || typeof body.title === 'string' ? { title: body.title } : {}),
    ...(body.description===null || typeof body.description === 'string' ? { description: body.description } : {}),
    ...(visibility ? { visibility } : {}),
    ...(placement ? { ancestor_ids: placement.ancestor_ids } : {}),
    ...(access ? { access } : {}),
    ...(link ? {link_role:link} : {}),
  };
  /*
   * A FOLDER'S WRITE IS THE METADATA WRITE — the PATCH door's, not a replace.
   *
   * Everything a folder takes is metadata (the content fields were refused
   * above), so there is nothing to archive and nothing to diff: routing it
   * through the replace door filed an archived copy of an empty state, wrote an
   * edit-log row and moved the version — the one number a caller reads to learn
   * that a document changed — for a rename. One code path (lib/artifacts
   * setMetadataFor) means the browser renaming a folder and an agent's
   * `update_artifact` are the same act, down to the trim on the title.
   *
   * The CAS is answered here rather than lost with the replace: a caller that
   * sent `expectedVersion` asked for a refusal, and a door that always says 200
   * because nothing moves the version is not a door that honoured it.
   */
  if (current.format === 'folder' && expected.expectedVersion !== undefined && current.version !== expected.expectedVersion) {
    return json({ error: 'version_conflict', currentVersion: current.version }, 409);
  }
  const row = current.format === 'folder'
    ? await setMetadataFor(actor, id, {
      ...(shares!==undefined?{shares}:{}),
      ...(body.title===null || typeof body.title === 'string' ? { title: body.title } : {}),
      ...(visibility ? { visibility } : {}),
      ...(placement ? { ancestor_ids: placement.ancestor_ids } : {}),
    }, expected)
    : await replaceArtifactFor(actor, id, input, {...expected,annotationOps,shares});
  if (isVersionConflict(row)) return json({ error: row.reason ?? 'version_conflict', currentVersion: row.currentVersion, ...(row.currentState ? {currentState:row.currentState} : {}) }, 409);
  if (!row) return json({ error: 'not_found' }, 404);

  // Dataset/viz refresh: warn about dependents whose bindings no longer
  // resolve (warnings, never blocks). A DIFFERENT shape from the asset
  // warnings below, which is exactly why it is a different key.
  const warnings = await refreshWarningsFor(actor, row);
  const affected = ['dataset','image','pdf','file'].includes(row.format) ? await findDependentsFor(actor,row.id) : null;
  return json({
    id: row.id, url: `${base}/a/${row.id}`, version: row.version, visibility: row.visibility,
    ...(affected?{affected_dependents:affected.map(dependent=>({id:dependent.id,title:dependent.title}))}:{}),
    // A replace moves the head pointer — hand back the new one so the caller
    // can keep editing without a re-read. A FOLDER's metadata write moves
    // neither the version nor this pointer, so what comes back is the head the
    // caller already had: still the answer to "what do I quote next", which is
    // the only thing it is for.
    edit_id: row.edit_id, state: artifactState(row),...(row.shares!==undefined?{shares:row.shares}:{}),
    title:row.title,description:row.description,theme:row.meta.theme??null,template:row.meta.template??null,link_role:row.link_role??'viewer',parent_id:parentOf(row),format:row.format,
    ...markupEcho(sentMarkup, row.source),
    // A dataset echoes its WRITE acl too: an agent that just set it should not
    // have to re-read to see what it got.
    ...(row.format === 'dataset' ? { access: row.access } : {}),
    // Annotations are sidecar state a replace cannot touch — the count is the
    // echo's signal that feedback exists (the GET inlines the full set).
    ...(row.format === 'markup' || row.format === 'folder' ? { open_annotations: await countOpenAnnotations(row.id) } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...assetWarningsEcho(parsed.warnings),
    ...sourceRepairsEcho(parsed.repairs),
  });
}

/**
 * The JSON create pipeline — one implementation for the bearer route, the MCP
 * tool and the operations registry (lib/operations). The HTTP route keeps one
 * transport-only branch of its own: a raw `Content-Type: image/*` body, which
 * has no JSON envelope for this function to read.
 */
export async function createArtifactFromBody(
  body: Record<string, unknown>,
  actor: TokenActor,
  base: string,
  request?: Request,
  options: {dryRun?:boolean; loadRef?:RefLoader} = {},
): Promise<Response> {
  let responseBody: ((row: ArtifactRow) => Record<string,unknown>) = row => createdArtifactWire(row,base,body.markup);
  let operation;
  try {operation = creationOperation(actor,base,request?.headers.get('Idempotency-Key'),body,row=>({status:201,body:responseBody(row)}));}
  catch(error){if(error instanceof CreationReplay)return json(error.reply.body,error.reply.status);throw error;}
  if(operation){const replay=await lookupCreation(await getDb(),operation);if(replay)return json(replay.body,replay.status);}
  if (await artifactQuotaExceeded(actor.tokenId)) return json({ error: 'quota_exceeded', details: ['this token has hit its artifact COUNT quota — deleting does not free it (nothing is erased), so ask your user for another token'] }, 403);
  const shares=parseShareEntries(body.shares);if(shares instanceof Response)return shares;
  if(body.visibility===null||body.linkRole===null)return json({error:'invalid_metadata',hint:'visibility and linkRole cannot be null.'},400);
  const link=parseLinkRoleValue(body.linkRole);if(link instanceof Response)return link;
  const sentMarkup=body.markup;
  const prepared = await prepareContentInput(body, {
    normalizeMarkup: source => stampNodeIds(source,{retireLegacyAliases:true}).source,
    creating: true,
    prepareDataset: (input,objects) => prepareCatalog(input,actor,undefined,objects),
    loadRef: options.loadRef ?? refLoaderForActor(actor),
    overByteQuota: byteQuotaFor(actor.tokenId),
  }, {allowRemoteInputs:!options.dryRun});
  if (prepared instanceof Response) return prepared;
  let parsed = prepared.content;
  const visibility = parseVisibility(body, !!actor.userId);
  if (visibility instanceof Response) return visibility;
  const access = parseAccessField(body, parsed.format);
  if (access instanceof Response) return access;
  if(access==='readwrite'&&catalogOf(parsed)?.kind==='postgres')return json({error:'dataset_read_only',details:['Postgres datasets are read-only']},400);
  const parent = parseParentField(body);
  if (parent instanceof Response) return parent;
  // Nothing exists yet to be unreachable, so there is no ordering question
  // here: the parent is the only row being read, and it must be the caller's
  // own folder or this is the one refusal.
  const placement = parent === undefined ? { ancestor_ids: [] } : await resolveParent(actor, parent, null);
  if (isParentRefusal(placement)) return json(placement, 400);

  if (options.dryRun) return preflightReply(prepared);

  const applied = await applyPreparedContent(prepared, {importAsset: assetImporterFor(actor.tokenId, actor.userId), resolveFont: fontResolver()});
  if (applied instanceof Response) return applied;
  parsed = applied;
  responseBody = row => ({...createdArtifactWire(row,base,sentMarkup),...assetWarningsEcho(parsed.warnings),...sourceRepairsEcho(parsed.repairs)});
  let row;
  try{row = await createArtifact(actor.tokenId, actor.userId, {
    ...parsed,
    title: body.title===null || typeof body.title === 'string' ? body.title : parsed.derivedTitle,
    description: body.description===null || typeof body.description === 'string' ? body.description : null,
    ...(visibility ? { visibility } : {}),
    ...(access ? { access } : {}),
    ancestor_ids: placement.ancestor_ids,
  }, {operation,shares,...(link?{linkRole:link}:{})});}catch(error){if(error instanceof CreationReplay)return json(error.reply.body,error.reply.status);if(error instanceof DatasetError)return json({error:'dataset_error',details:[error.message]},error.status);throw error;}
  return json(responseBody(row), 201);
}

/**
 * WHAT A FRESHLY MADE ARTIFACT ANSWERS — the create reply, built from the
 * stored row alone so every door that makes one speaks it: `create_artifact`
 * and `fork_artifact` (which adds `forked_from` to it). An agent's next call
 * after either is the same edit loop, so the two replies must not differ in
 * shape — a fork that answered its own vocabulary would make the copy a
 * second thing to learn.
 */
export function createdArtifactWire(row: ArtifactRow, base: string, sentMarkup: unknown): Record<string, unknown> {
  const meta = row.meta as { columns?: unknown; rowCount?: unknown; slots?: unknown; bytes?: number; pages?: number; filename?: string; contentType?: string };
  return {
    id: row.id, url: `${base}/a/${row.id}`, version: row.version, visibility: row.visibility,
    // The read-proof for the edit protocol: an agent can start editing straight
    // after create, without a round trip to learn the head pointer.
    edit_id: row.edit_id, state: artifactState(row),...(row.shares!==undefined?{shares:row.shares}:{}),
    format: row.format, title: row.title,description:row.description,theme:row.meta.theme??null,template:row.meta.template??null,link_role:row.link_role??'viewer',
    // Where it landed. `parent_id` is what a caller writes back, so the create
    // reply hands it straight into the next call.
    parent_id: parentOf(row), ancestor_ids: row.ancestor_ids,
    ...markupEcho(sentMarkup, row.source),
    // Echoes teach the agent its bindable surface without a second round trip.
    ...(row.format === 'dataset' ? datasetCreateFields(row.id, meta.columns, meta.rowCount, meta as { totalRows?: number; truncated?: boolean }, row.access) : {}),
    ...(row.format === 'viz' ? { slots: meta.slots } : {}),
    // Where the BYTES are, for a caller that must render the image before it
    // has re-read the document (lib/story/ref-data owns the shape, so this
    // cannot drift from the render path).
    ...(row.format === 'image' ? { rawUrl: imageRawUrl(row.id, row.version) } : {}),
    // Same for a PDF, plus the two facts a <File> card shows: an agent that has
    // just uploaded one can write the card without re-reading anything.
    ...(row.format === 'file' ? { rawUrl: imageRawUrl(row.id, row.version), filename: meta.filename, contentType: meta.contentType, bytes: meta.bytes } : {}),
    ...(row.format === 'pdf' ? { rawUrl: pdfRawUrl(row.id, row.version), bytes: meta.bytes ?? 0, ...(meta.pages ? { pages: meta.pages } : {}) } : {}),
  };
}

/** Body → EditInput; null = malformed (both content forms, neither change nor meta, wrong types). */
function parseEditBody(body: Record<string, unknown>): EditInput | null {
  const annotationOps=body.annotation_ops===undefined?[]:parseAnnotationOperations(body.annotation_ops);
  if(!annotationOps)return null;
  const editId = body.edit_id;
  if (typeof editId !== 'string' || editId.length === 0) return null;

  const mentionsDiff = Object.hasOwn(body, 'old_string') || Object.hasOwn(body, 'new_string');
  const mentionsSource = Object.hasOwn(body, 'source');
  const mentionsBatch = Object.hasOwn(body, 'edits');
  if ([mentionsDiff, mentionsSource, mentionsBatch].filter(Boolean).length > 1) return null;
  const hasDiff = typeof body.old_string === 'string' && typeof body.new_string === 'string';
  const hasSource = typeof body.source === 'string';
  const hasBatch = Array.isArray(body.edits) && body.edits.length > 0 && body.edits.length <= 64
    && body.edits.every((edit) => !!edit && typeof edit === 'object'
      && typeof (edit as Record<string, unknown>).old_string === 'string'
      && typeof (edit as Record<string, unknown>).new_string === 'string');
  if ((mentionsDiff && !hasDiff) || (mentionsSource && !hasSource) || (mentionsBatch && !hasBatch)) return null;
  const change = hasDiff
    ? { oldString: body.old_string as string, newString: body.new_string as string }
    : hasSource
      ? { newSource: body.source as string }
      : hasBatch
        ? { edits: (body.edits as Array<Record<string, string>>).map((edit) => ({ oldString: edit.old_string, newString: edit.new_string })) }
        : undefined;

  if (!change) return null;
  return {baseEditId: editId, change, ...(annotationOps.length ? {annotationOps} : {})};
}

/**
 * One edit against a claimed base (the concurrent-edit protocol on the wire).
 * Shared by the bearer route, the session-authed twin under /api/my, and the
 * MCP tool — same protocol, different ownership scope, which is what `apply`
 * carries in.
 */
export async function respondToEdit(
  base: string,
  body: Record<string, unknown> | null,
  apply: (input: EditInput) => Promise<EditOutcome | Response | null>,
): Promise<Response> {
  if (!body) return json({ error: 'invalid_json' }, 400);
  if (['meta','title','theme','colorMode','template','description','visibility','linkRole','parent_id','access'].some(key=>Object.hasOwn(body,key))) return json({error:'metadata_requires_patch',hint:'Use PATCH with expectedState for metadata only, or PUT with expectedVersion and expectedState for mixed content and metadata.'},400);
  const input = parseEditBody(body);
  if (!input) return json({ error: 'invalid_edit_body' }, 400);

  const outcome = await apply(input);
  if (outcome instanceof Response) return outcome; // publish-pipeline 400 (invalid_jsx, …)
  if (!outcome) return json({ error: 'not_found' }, 404);
  // The edit path runs the SAME publish door, so it answers the same way: a URL
  // it could not import is news wherever the write came in from.
  if (outcome.applied) return json({ ...await artifactToWire(outcome.row, base), ...assetWarningsEcho(outcome.warnings) });
  switch (outcome.reason) {
    case 'stale_edit_id':
    case 'doc_changed':
      return json({ error: outcome.reason, edit_id: outcome.head.editId, source: outcome.head.source, version: outcome.head.version }, 409);
    case 'bad_diff':
      return json({
        error: 'bad_diff', detail: outcome.detail,
        ...(outcome.detail === 'no_match' ? { recovery: 'Read the artifact again and copy old_string from its current stored markup. A rejected write changed nothing; do not match against the rejected proposal.' } : {}),
        ...(outcome.detail === 'multiple_matches' ? { recovery: 'Include surrounding stored text so old_string matches exactly once.' } : {}),
        ...(outcome.editIndex === undefined ? {} : { edit_index: outcome.editIndex }),
      }, 400);
    case 'not_editable':
      return json({ error: 'not_editable' }, 400);
  }
}

/** Body → action; null = malformed (neither field, or wrong types). */
function parseAnnotationAction(body: Record<string, unknown>): AnnotationAction | null {
  const action: AnnotationAction = {};
  if (typeof body.reply === 'string' && body.reply.trim().length > 0) action.reply = body.reply;
  else if (body.reply !== undefined) return null;
  if (typeof body.resolve === 'boolean') action.resolve = body.resolve;
  else if (body.resolve !== undefined) return null;
  if (typeof body.reopen === 'boolean') action.reopen = body.reopen;
  else if (body.reopen !== undefined) return null;
  if (action.resolve && action.reopen) return null; // contradictory transitions
  if (!action.reply && !action.resolve && !action.reopen) return null; // an action that does nothing is malformed
  return action;
}

/** The ONE annotation mutation — only the credential (and thus the attribution) differs per door. */
export async function respondToAnnotationAction(
  body: Record<string, unknown> | null,
  actor: TokenActor,
  author: AnnotationAuthor,
  id: string,
  annId: string,
): Promise<Response> {
  if (!body) return json({ error: 'invalid_json' }, 400);
  const action = parseAnnotationAction(body);
  if (!action) return json({ error: 'invalid_annotation_action' }, 400);
  const wire = await actOnAnnotationFor(actor, id, annId, action, author);
  if (!wire) return json({ error: 'not_found' }, 404);
  if (action.reply && author.kind === 'human') notifyRemoteComment(actor.userId, id, annId, wire.thread[wire.thread.length - 1]);
  return json(wire);
}

const isScalar = (v: unknown): v is Scalar =>
  v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/**
 * The owner's dataset write door: one INSERT/UPDATE/DELETE against a dataset
 * they own, with no document in the picture — appending today's rows must not
 * cost re-sending the whole table. The caller writes the SQL, which is safe
 * for the same reason `POST /api/query` is: it is their own dataset, the
 * statement is guarded by TYPE in a throwaway instance holding only that
 * table, and `access` still governs (`readwrite` required even for the owner —
 * the toggle is the one place that says a dataset is writable).
 */
export async function respondToMutate(
  actor: TokenActor,
  id: string,
  body: Record<string, unknown> | null,
  receipt?:MutationReceipt,
): Promise<Response> {
  const dataset = await getArtifactFor(actor, id);
  if (!dataset) return json({ error: 'not_found' }, 404);

  const refusal = await canWriteDataset(dataset, actor);
  if (refusal === 'not_a_dataset') {
    return json({ error: 'not_a_dataset', details: [`${id} is a ${dataset.format} artifact — only datasets hold rows to write`] }, 400);
  }
  if (refusal) {
    return json({
      error: 'dataset_read_only',
      details: [`${id} is read-only — set access: readwrite (PUT here, or PATCH /api/my/artifacts/${id})`],
    }, 403);
  }

  if (!body) return json({ error: 'invalid_json' }, 400);
  if (typeof body.sql !== 'string' || body.sql.trim() === '') {
    return json({ error: 'sql_required', details: [`one INSERT, UPDATE or DELETE naming a catalog table, for example public.rows`] }, 400);
  }
  const expected=body.expectedState===undefined?undefined:parseExpectedVersion(body,false);
  if(expected instanceof Response)return expected;
  const values: Record<string, Scalar> = {};
  if (body.values !== undefined) {
    if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
      return json({ error: 'invalid_values', details: ['values must be an object of scalars'] }, 400);
    }
    for (const [k, v] of Object.entries(body.values as Record<string, unknown>)) {
      if (!isScalar(v)) return json({ error: 'invalid_values', details: [`value "${k}" must be a string, number, boolean or null`] }, 400);
      values[k] = v;
    }
  }

  const result = await mutateDataset(dataset, actor, body.sql, values,{receipt,expectedState:expected?.expectedState});
  if (isMutationRefused(result)) {
    if(result.reason==='row_changed')return json({error:'row_changed',details:[result.detail]},409);
    if (result.reason === 'dataset_read_only' || result.reason === 'policy_denied') return json({error:result.reason,details:[result.detail]},403);
    if (result.reason === 'dataset_full') return json({ error: 'dataset_full', details: [result.detail] }, 409);
    // Contention is retryable, not an author error — never a 400.
    if (result.reason === 'contended') return json({ error: 'dataset_busy', details: [result.detail] }, 503, { 'Retry-After': '1' });
    return json({ error: 'invalid_sql', details: [result.detail] }, 400);
  }
  return json({ id: result.row.id, version: result.row.version, affected: result.affected, rowCount: result.rowCount });
}

/**
 * REFRESH — one pipeline, two doors (the `refresh_asset` operation and the
 * owner's menu row), because a bearer agent and a person clicking a menu must
 * not be able to mean different things by it.
 *
 * `url` refreshes one URL we hold. `id` refreshes every external URL a DOCUMENT
 * names — the shape a person actually wants ("this deck's pictures are stale"),
 * and the one an agent can call without first knowing which URLs are in there.
 * Reach for the document form is the WRITE scope, not the read one: refreshing
 * changes bytes every reader of every document naming that URL will see, so it
 * belongs to someone who may change the document, and the miss is the uniform
 * 404 that every other door answers.
 *
 * The hourly web-import allowance is the same bucket a publish spends
 * (lib/auth) and is charged PER URL inside `refreshWebAssets`, because these
 * are the same fetches: one call must not buy N of them for one slot. A url
 * that cannot be paid for comes back in `failed` as `rate_limited`, beside the
 * urls that could — a partial refresh is more useful than a refused one.
 */
export async function refreshAssetsFor(
  actor: TokenActor,
  input: { url?: unknown; id?: unknown },
): Promise<Response> {
  const url = typeof input.url === 'string' && input.url ? input.url : null;
  const id = typeof input.id === 'string' && input.id ? input.id : null;
  if (!url && !id) return json({ error: 'nothing_to_refresh', details: ['name a url, or the id of a document whose external urls should be refreshed'] }, 400);

  let urls: string[];
  let by: WebAssetImporter = { tokenId: actor.tokenId, userId: actor.userId };
  if (id) {
    const row = await getArtifactFor(actor, id);
    if (!row) return json({ error: 'not_found' }, 404);
    urls = collectExternalAssetUrls(row.source ?? '').all;
    // The bytes belong to whoever the DOCUMENT belongs to, exactly as they did
    // when publish imported them — an editor refreshing does not take them over.
    const owner = writerFor(row);
    by = { tokenId: owner.tokenId, userId: owner.userId };
  } else {
    urls = [url!];
  }
  return json(await refreshWebAssets(urls, by));
}

function preflightReply(prepared:PreparedContent):Response {
  return json({valid:true,dry_run:true,markup:prepared.content.source,format:prepared.content.format,
    planned:{objects:prepared.objects.length,imports:prepared.markup?.imports??[],fonts:prepared.markup?.fonts??[]},
    commit_checks:['authorization','quota','references','observed_state'],...sourceRepairsEcho(prepared.content.repairs)});
}
