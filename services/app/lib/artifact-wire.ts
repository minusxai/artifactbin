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
  DATASET_ACCESS, SHARE_ROLES, artifactQuotaExceeded, canWriteDataset, byteQuotaFor, createArtifact, fontResolver, getArtifactFor, assetImporterFor, isVersionConflict, refLoaderForActor, refreshWarningsFor, replaceArtifactFor, writerFor,
  type ArtifactInput, type ArtifactRow, type ArtifactSummary, type DatasetAccess, type EditInput, type EditOutcome, type ReplaceOpts, type ShareEntry, type ShareRole, type TokenActor, type Visibility,
} from '@/lib/artifacts';
import { actOnAnnotationFor, annotationsWireForRow, countOpenAnnotations, type AnnotationAction, type AnnotationAuthor } from '@/lib/annotations';
import { isMutationRefused, mutateDataset } from '@/lib/story/dataset-mutate';
import type { Scalar } from '@/lib/story/dataflow';
import { datasetCreateFields } from '@/lib/story/dataset-usage';
import { imageRawUrl } from '@/lib/story/ref-data';
import { ALLOW_PUBLIC_VISIBILITY } from '@/lib/config';
import { canSetDatasetAccess } from '@/lib/features';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { json, readJson } from '@/lib/http';
import { parseFolder } from '@/lib/urls';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { parseContentInput } from '@/lib/story/input';
import { collectExternalAssetUrls } from '@/lib/story/external-images';
import type { AssetWarning } from '@/lib/web-assets';
import { refreshWebAssets, type WebAssetImporter } from '@/lib/web-assets';

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
    folder: row.folder,
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
  return row.format === 'markup' ? { ...wire, annotations: await annotationsWireForRow(row) } : wire;
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

/** Full wire shape for a single-artifact read. */
export async function artifactToWire(row: ArtifactRow, base: string) {
  const { content, source, token_id: _token, user_id: _owner, meta, format, ...rest } = row;
  const m = meta as { theme?: string; template?: string; colorMode?: 'light' | 'dark' | null };
  // Echo the LIVE vocabulary: a stored retired theme reads back as its
  // successor, so an agent that read-before-writes never learns a name that
  // publish would reject.
  const design = resolveStoredStoryDesign(m.theme, m.colorMode ?? null);
  return {
    ...rest,
    format,
    url: `${base}/a/${row.id}`,
    markup: source,
    // Annotations are sidecar state (lib/annotations) — the write path never
    // round-trips them, so every echo carries the open COUNT as the signal;
    // the artifact GET additionally inlines the full open set.
    ...(format === 'markup' ? { open_annotations: await countOpenAnnotations(row.id) } : {}),
    // markup (story-engine) tier only: the source IS the artifact;
    // template/colorMode ride meta.
    ...(format === 'markup'
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
  };
}

/**
 * Optional optimistic-concurrency guard on PUT bodies: absent ⇒ last-write-
 * wins (the curl-friendly default), a number ⇒ apply only at that head
 * version, anything else ⇒ 400 (never a silent overwrite).
 */
function parseExpectedVersion(body: Record<string, unknown>): ReplaceOpts | Response {
  const v = body.expectedVersion;
  if (v === undefined || v === null) return {};
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return { expectedVersion: v };
  return json({ error: 'invalid_expected_version' }, 400);
}

export function parseFolderField(body: Record<string, unknown>): string | undefined | Response {
  const f = body.folder;
  if (f === undefined || f === null) return undefined;
  if (typeof f !== 'string') return json({ error: 'invalid_folder' }, 400);
  const folder = parseFolder(f);
  if (folder === null) return json({ error: 'invalid_folder' }, 400);
  return folder;
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
export function parseAccessValue(v: unknown, format: string | undefined, request: Request): DatasetAccess | undefined | Response {
  if (v === undefined || v === null || v === '') return undefined;
  if (!DATASET_ACCESS.includes(v as DatasetAccess)) {
    return json({ error: 'invalid_access', allowed: [...DATASET_ACCESS] }, 400);
  }
  if (format !== undefined && format !== 'dataset') {
    return json({ error: 'access_datasets_only', details: [`access is the write ACL of a dataset — a ${format} artifact has no rows to write`] }, 400);
  }
  // THE ONE PREVIEW GATE for writable datasets (lib/features/): making a
  // dataset writable is the single act everything else follows from, so this
  // is the only place the flag is consulted. Reading and serving are never
  // gated — a document published in the preview keeps working for readers who
  // have no flag, which is what makes a shareable link safe to gate at all.
  if (v === 'readwrite' && !canSetDatasetAccess(request)) {
    return json({
      error: 'preview_feature',
      details: ['writable datasets are in preview — add ?v=2 to this request (a browser carries it from the page URL), or set PREVIEW__FEATURES=1 on the deployment'],
    }, 400);
  }
  return v as DatasetAccess;
}

/** Not RFC-grade on purpose — the address only has to be matchable at login. */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_SHARES = 100;

/**
 * The share list on the wire: `{email, role}` entries, or bare email strings
 * (the shape before roles — a viewer). Absent = leave the list alone. Every
 * entry is validated, none silently dropped: a typo'd address that vanished
 * from the list would read as "shared" to the person who typed it, and a
 * role the door does not know is refused BY NAME.
 */
export function parseShareEntries(v: unknown): ShareEntry[] | undefined | Response {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > MAX_SHARES) return json({ error: 'invalid_shares' }, 400);
  const entries: ShareEntry[] = [];
  for (const raw of v) {
    const entry = typeof raw === 'string' ? { email: raw, role: 'viewer' } : raw;
    const email = typeof entry?.email === 'string' ? entry.email.trim() : '';
    if (!EMAIL_RE.test(email)) return json({ error: 'invalid_shares', detail: String(entry?.email ?? raw) }, 400);
    if (!SHARE_ROLES.includes(entry.role)) return json({ error: 'invalid_shares', detail: `role: ${String(entry.role)}`, hint: `one of ${SHARE_ROLES.join(', ')}` }, 400);
    entries.push({ email, role: entry.role });
  }
  return entries;
}

function parseAccessField(body: Record<string, unknown>, format: string | undefined, request: Request): DatasetAccess | undefined | Response {
  return parseAccessValue(body.access, format, request);
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
  return replaceArtifactWithBody(body, actor, id, base, request);
}

/** The same pipeline with the body already in hand — what the operations registry calls. */
export async function replaceArtifactWithBody(
  body: Record<string, unknown> | null,
  actor: TokenActor,
  id: string,
  base: string,
  request: Request,
): Promise<Response> {
  if (!body) return json({ error: 'invalid_json' }, 400);
  // The row FIRST: refs and imports resolve as the DOCUMENT's owner, never as
  // the writer — an editor (artifact_shares.role) replacing a document that
  // carries its owner's <Mutation> or private image must not fail on assets
  // they could never own. Unreachable is the uniform 404, before any parse.
  const current = await getArtifactFor(actor, id);
  if (!current) return json({ error: 'not_found' }, 404);
  const owner = writerFor(current);
  const parsed = await parseContentInput(body, {
    loadRef: refLoaderForActor(owner),
    importAsset: assetImporterFor(owner.tokenId, owner.userId),
    resolveFont: fontResolver(),
    overByteQuota: byteQuotaFor(owner.tokenId),
  });
  if (parsed instanceof Response) return parsed;

  const visibility = parseVisibility(body, !!actor.userId);
  if (visibility instanceof Response) return visibility;
  const folder = parseFolderField(body);
  if (folder instanceof Response) return folder;
  const access = parseAccessField(body, parsed.format, request);
  if (access instanceof Response) return access;
  const expected = parseExpectedVersion(body);
  if (expected instanceof Response) return expected;

  const input: ArtifactInput = {
    ...parsed,
    ...(typeof body.title === 'string' ? { title: body.title } : {}),
    ...(typeof body.description === 'string' ? { description: body.description } : {}),
    ...(visibility ? { visibility } : {}),
    ...(folder !== undefined ? { folder } : {}),
    ...(access ? { access } : {}),
  };
  const row = await replaceArtifactFor(actor, id, input, expected);
  if (isVersionConflict(row)) return json({ error: 'version_conflict', currentVersion: row.currentVersion }, 409);
  if (!row) return json({ error: 'not_found' }, 404);

  // Dataset/viz refresh: warn about dependents whose bindings no longer
  // resolve (warnings, never blocks). A DIFFERENT shape from the asset
  // warnings below, which is exactly why it is a different key.
  const warnings = await refreshWarningsFor(actor, row);
  return json({
    id: row.id, url: `${base}/a/${row.id}`, version: row.version, visibility: row.visibility,
    // A replace moves the head pointer — hand back the new one so the caller
    // can keep editing without a re-read.
    edit_id: row.edit_id,
    ...markupEcho(body.markup, row.source),
    // A dataset echoes its WRITE acl too: an agent that just set it should not
    // have to re-read to see what it got.
    ...(row.format === 'dataset' ? { access: row.access } : {}),
    // Annotations are sidecar state a replace cannot touch — the count is the
    // echo's signal that feedback exists (the GET inlines the full set).
    ...(row.format === 'markup' ? { open_annotations: await countOpenAnnotations(row.id) } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...assetWarningsEcho(parsed.warnings),
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
  request: Request,
): Promise<Response> {
  if (await artifactQuotaExceeded(actor.tokenId)) return json({ error: 'quota_exceeded' }, 403);
  const parsed = await parseContentInput(body, {
    loadRef: refLoaderForActor(actor),
    importAsset: assetImporterFor(actor.tokenId, actor.userId),
    resolveFont: fontResolver(),
    overByteQuota: byteQuotaFor(actor.tokenId),
  });
  if (parsed instanceof Response) return parsed;
  const visibility = parseVisibility(body, !!actor.userId);
  if (visibility instanceof Response) return visibility;
  const access = parseAccessField(body, parsed.format, request);
  if (access instanceof Response) return access;
  const folder = parseFolderField(body);
  if (folder instanceof Response) return folder;

  const row = await createArtifact(actor.tokenId, actor.userId, {
    ...parsed,
    title: typeof body.title === 'string' ? body.title : parsed.derivedTitle,
    description: typeof body.description === 'string' ? body.description : null,
    ...(visibility ? { visibility } : {}),
    ...(access ? { access } : {}),
    ...(folder !== undefined ? { folder } : {}),
  });
  return json({
    ...createdArtifactWire(row, base, body.markup),
    ...assetWarningsEcho(parsed.warnings),
  }, 201);
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
  const meta = row.meta as { columns?: unknown; rowCount?: unknown; slots?: unknown };
  return {
    id: row.id, url: `${base}/a/${row.id}`, version: row.version, visibility: row.visibility,
    // The read-proof for the edit protocol: an agent can start editing straight
    // after create, without a round trip to learn the head pointer.
    edit_id: row.edit_id,
    format: row.format, title: row.title, folder: row.folder,
    ...markupEcho(sentMarkup, row.source),
    // Echoes teach the agent its bindable surface without a second round trip.
    ...(row.format === 'dataset' ? datasetCreateFields(row.id, meta.columns, meta.rowCount, meta as { totalRows?: number; truncated?: boolean }, row.access) : {}),
    ...(row.format === 'viz' ? { slots: meta.slots } : {}),
    // Where the BYTES are, for a caller that must render the image before it
    // has re-read the document (lib/story/ref-data owns the shape, so this
    // cannot drift from the render path).
    ...(row.format === 'image' ? { rawUrl: imageRawUrl(row.id, row.version) } : {}),
  };
}

/** Body → EditInput; null = malformed (both content forms, neither change nor meta, wrong types). */
function parseEditBody(body: Record<string, unknown>): EditInput | null {
  const editId = body.edit_id;
  if (typeof editId !== 'string' || editId.length === 0) return null;

  const hasDiff = typeof body.old_string === 'string' && typeof body.new_string === 'string';
  const hasSource = typeof body.source === 'string';
  if (hasDiff && hasSource) return null; // at most one content form
  const change = hasDiff
    ? { oldString: body.old_string as string, newString: body.new_string as string }
    : hasSource
      ? { newSource: body.source as string }
      : undefined;

  // Document-level attributes; each optional, each only when well-typed.
  const meta: NonNullable<EditInput['meta']> = {};
  if (body.title === null || typeof body.title === 'string') meta.title = body.title;
  if (body.theme === null || typeof body.theme === 'string') meta.theme = body.theme;
  // null is an explicit CLEAR (back to the theme's declared default) — distinct from absent.
  if (body.colorMode === 'light' || body.colorMode === 'dark' || body.colorMode === null) meta.colorMode = body.colorMode;
  const hasMeta = Object.keys(meta).length > 0;

  if (!change && !hasMeta) return null; // an edit that changes nothing is malformed
  return { baseEditId: editId, ...(change ? { change } : {}), ...(hasMeta ? { meta } : {}) };
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
      return json({ error: 'bad_diff', detail: outcome.detail }, 400);
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
): Promise<Response> {
  const dataset = await getArtifactFor(actor, id);
  if (!dataset) return json({ error: 'not_found' }, 404);

  const refusal = canWriteDataset(dataset, actor);
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
    return json({ error: 'sql_required', details: [`one INSERT, UPDATE or DELETE naming this dataset as ref_${id}`] }, 400);
  }
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

  const result = await mutateDataset(dataset, body.sql, values);
  if (isMutationRefused(result)) {
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
