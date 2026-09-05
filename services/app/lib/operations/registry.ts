/**
 * THE OPERATIONS REGISTRY — one curated array of everything an agent can do
 * to an artifact, rendered three ways: the MCP tools (`app/mcp/route.ts`
 * loops over it), the bearer HTTP routes (each route is a translation layer
 * over its operation's `run`), and the docs' endpoint reference (a nunjucks
 * global, rendered per transport). One list, one set of input shapes, one
 * error vocabulary — a refusal cannot be documented in one transport and not
 * the other.
 *
 * This is NOT generated from routes — the generators' pitfall. It is the
 * curated surface: model-facing descriptions, action verbs, one worked
 * example each, read/write/destructive annotated (`annotate` stays ONE
 * operation for reply/resolve/reopen). `run` is transport-free: it takes an
 * actor + the caller's base origin and answers an `OpReply` (status + body).
 * The semantic depth lives in lib/artifact-wire and lib/artifacts — `run`
 * bodies are those same shared pipelines, so the two transports cannot fork.
 *
 * Two deliberate deviations from the fuller sketch, both to keep today's
 * wire contracts byte-compatible: no MCP `outputSchema` (the spec makes it
 * binding on the server, which would change every tool response envelope),
 * and the HTTP layer keeps its hand validation (the suite pins its named
 * error codes — `invalid_edit_body`, `version_required` — where a zod parse
 * would answer a zod error). The zod shapes remain the single source for the
 * MCP schema and the docs.
 */
import { z } from 'zod';
import {
  applyEditFor, canReadArtifact, findDependentsFor, forkArtifact, getArtifactById, getArtifactFor, getOwnedArtifactFor, getVersionFor, listArtifactsFor, listVersionsFor,
  revertArtifactFor, isVersionNotArchived, type ForkOverrides, type TokenActor,
} from '@/lib/artifacts';
import { isParentRefusal, resolveParent } from '@/lib/folders';
import { restoreArtifactFor, trashArtifactFor } from '@/lib/trash';
import { trackEvent } from '@/lib/analytics';
import { exportImageResponse } from '@/lib/export';
import type { AnnotationAuthor } from '@/lib/annotations';
import {
  artifactSummaryToWire, artifactToWireWithAnnotations, createArtifactFromBody, createdArtifactWire, parseParentField, parseVisibilityValue, replaceArtifactWithBody,
  refreshAssetsFor, respondToAnnotationAction, respondToEdit, respondToMutate,
} from '@/lib/artifact-wire';
import { MARKUP_FIELD_GUIDANCE, DATASET_FIELD_GUIDANCE, SHEET_URL_FIELD_GUIDANCE, IMAGE_URL_FIELD_GUIDANCE, CSV_URL_FIELD_GUIDANCE, PDF_FIELD_GUIDANCE, PDF_URL_FIELD_GUIDANCE } from '@/lib/agent-guidance';

/** What an operation answers: a status and a JSON body, transport-free. */
export interface OpReply {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  /**
   * Image payload (export_artifact): MCP renders it as a native image content
   * block, HTTP as the bytes. When set, `body` is ignored on success.
   */
  image?: { base64: string; mimeType: string };
}

/** What every `run` gets: who is calling, from where, and how to attribute them. */
export interface OpContext {
  actor: TokenActor;
  /** The caller's own origin — every `url` in a reply is built from it. */
  base: string;
  /** The transport request passed through to the publish pipeline. */
  request: Request;
  /** Who a comment reply is attributed to; derived per transport. */
  author: AnnotationAuthor;
}

export interface OperationError {
  status: number;
  code: string;
  fix: string;
}

export interface Operation {
  /** The MCP tool name — an action verb, never a route transliteration. */
  name: string;
  title: string;
  http: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string };
  /** ONE model-facing paragraph: what it does, when to use it, what comes back. */
  description: string;
  /** zod raw shape — the MCP inputSchema and the docs' field table. */
  input: z.ZodRawShape;
  annotations: { readOnly?: boolean; destructive?: boolean; idempotent?: boolean };
  /** One worked example, rendered as curl or as a tool call by the docs. */
  example: { input: Record<string, unknown>; note?: string };
  /** The refusals this operation can answer — the docs' error table rows. */
  errors: OperationError[];
  run(ctx: OpContext, input: Record<string, unknown>): Promise<OpReply>;
}

/** A lib pipeline already answers a Response; an OpReply is that, transport-free. */
async function fromResponse(res: Response): Promise<OpReply> {
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = { error: `http_${res.status}` };
  }
  const retry = res.headers.get('Retry-After');
  return { status: res.status, body, ...(retry ? { headers: { 'Retry-After': retry } } : {}) };
}

const reply = (body: Record<string, unknown>, status = 200): OpReply => ({ status, body });

/**
 * The one-of content fields every create/update takes — the field-level
 * guidance strings are the same ones the docs table renders, so the MCP
 * schema and the docs read one place.
 */
const CONTENT_FIELDS = {
  markup: z.string().optional().describe(MARKUP_FIELD_GUIDANCE),
  dataset: z.union([z.array(z.record(z.string(), z.unknown())), z.string()]).optional().describe(DATASET_FIELD_GUIDANCE),
  sheetUrl: z.string().optional().describe(SHEET_URL_FIELD_GUIDANCE),
  columns: z.array(z.object({ name: z.string(), type: z.enum(['string', 'number', 'boolean', 'date']) })).optional().describe('dataset: declared column types (win over inference)'),
  viz: z.record(z.string(), z.unknown()).optional().describe('viz tier: a recipe {description, engine, bindings, params?, template} with {{slot}} tokens'),
  image: z.string().optional().describe('image tier: a base64 data: URL (png|jpeg|webp|gif|svg+xml)'),
  imageUrl: z.string().optional().describe(IMAGE_URL_FIELD_GUIDANCE),
  pdf: z.string().optional().describe(PDF_FIELD_GUIDANCE),
  pdfUrl: z.string().optional().describe(PDF_URL_FIELD_GUIDANCE),
  csvUrl: z.string().optional().describe(CSV_URL_FIELD_GUIDANCE),
  title: z.string().optional(),
  description: z.string().optional().describe('shown on the owner dashboard, never on the document'),
  // A string, NOT an enum: the publish pipeline owns theme validation, and its
  // rejections carry the vocabulary an agent needs (`allowed` for an unknown
  // name, the successor hint for a retired one). A zod enum would swallow both
  // into a generic schema error.
  theme: z.string().optional().describe('design personality (fonts, radius, light+dark palettes): modernist | organic | industry | terminal | manuscript | pop; a retired name (classical/broadsheet/nocturne) is rejected with a hint naming its successor'),
  template: z.enum(['editorial', 'deck', 'scrolly', 'dashboard']).optional(),
  colorMode: z.enum(['light', 'dark']).optional().describe("the AUTHOR's default mode; every theme has both palettes and readers can flip at view time"),
  // A FOLDER IS AN ARTIFACT, so the create door's `format` takes exactly one
  // value: everything else is named by its content field, and only a folder
  // has none.
  format: z.enum(['folder']).optional().describe("a folder: send it with NO content field. A folder is an artifact like any other — it has a url, visibility and sharing — and you file documents under it with parent_id"),
  parent_id: z.string().nullable().optional().describe("the id of a FOLDER artifact to file this under (create one with {\"format\":\"folder\",\"title\":\"…\"}), or null for your root. Ids, never paths: two sibling folders may share a name. The URL keeps working wherever the file moves"),
  access: z.enum(['read', 'readwrite']).optional().describe("dataset WRITE ACL: 'read' (default — documents may only read it) or 'readwrite' (documents you publish may add/change/remove rows through a <Mutation>)."),
  visibility: z.enum(['public', 'private', 'unlisted']).optional().describe("read ACL: 'public' = anyone with the link, and it lists on the owner's public profile; 'unlisted' = anyone with the link, but never listed anywhere; 'private' = the owner + emails they share it with (needs a logged-in account — anonymous tokens can be public or unlisted). Defaults: account-owned tokens publish private — except images and datasets, born unlisted; anonymous tokens publish public."),
};

/** The placement refusals, stated once. One code covers every way a parent can be wrong. */
const INVALID_PARENT: OperationError = { status: 400, code: 'invalid_parent', fix: "parent_id must be the id of a FOLDER you own, not inside the thing you are moving, and no more than 6 levels deep — one code on purpose, because naming which would reveal whether an id exists. Create a folder with {\"format\":\"folder\"}" };
const FOLDER_RETIRED: OperationError = { status: 400, code: 'folder_retired', fix: "the `folder` path field is gone — send parent_id: the id of a folder artifact (create one with format: 'folder')" };
/**
 * GOVERNANCE IS THE OWNER'S. The replace door runs under `editorScope`, so a
 * named editor reaches it — and `visibility`/`access` decide who else may read
 * the document and write its rows, which is not what they were invited to do.
 * Every other governance surface is owner-scoped and answers them the uniform
 * 404 instead, which is why this code exists on exactly one door.
 */
const OWNER_ONLY: OperationError = { status: 403, code: 'owner_only', fix: "visibility and access belong to the artifact's owner — you hold an editor share on it, so send the update without them" };

const NOT_FORKABLE: OperationError = { status: 400, code: 'not_forkable', fix: "a folder cannot be forked — create your own with {\"format\":\"folder\"} and file documents under it with parent_id" };

const INVALID_JSX: OperationError = { status: 400, code: 'invalid_jsx', fix: 'details names each problem with its span; a refused tag answer carries allowed_html_tags — pick from it' };
const INVALID_REFS: OperationError = { status: 400, code: 'invalid_refs', fix: 'details names each ref: an id that does not resolve for YOU, a wrong kind, or a <Mutation> target that is not your own readwrite dataset — publish your own copy of it' };

/** The shared write refusals, stated once and spread into each writer's table. */
const CONTENT_ERRORS: OperationError[] = [
  INVALID_JSX,
  INVALID_REFS,
  { status: 400, code: 'unknown_theme', fix: 'the 400 carries allowed — the six live theme names' },
  { status: 400, code: 'retired_theme', fix: 'the hint names the successor theme — use it' },
  { status: 400, code: 'image_fetch_failed', fix: 'the named image URL could not be imported — check it serves image bytes publicly' },
  { status: 400, code: 'invalid_pdf', fix: 'pdf must be a base64 data:application/pdf URL whose BYTES are a PDF — to publish one already on the web send pdfUrl' },
  { status: 413, code: 'pdf_too_large', fix: 'the file is over the PDF cap named in maxBytes — link a smaller copy' },
  { status: 400, code: 'pdf_fetch_failed', fix: 'the named pdfUrl could not be imported — check it serves PDF bytes publicly and is under the cap' },
  { status: 400, code: 'public_not_enabled', fix: 'this deployment has not opened public documents — use "unlisted"' },
  { status: 400, code: 'private_requires_account', fix: 'private needs a logged-in owner — claim the token or use unlisted' },
  INVALID_PARENT,
  FOLDER_RETIRED,
];

const NOT_FOUND: OperationError = { status: 404, code: 'not_found', fix: 'the id is wrong OR this token cannot reach it — existence is never revealed; list_artifacts shows what you can reach' };

const createArtifactOp: Operation = {
  name: 'create_artifact',
  title: 'Create an artifact',
  http: { method: 'POST', path: '/api/artifacts' },
  description: 'Create an artifact (exactly one of markup | dataset | viz | image | pdf). Returns the public URL. markup is THE document format: story JSX over the component kit, HTML tags for everything else (prose is ordinary <p>/<h1>/<ul> — there is no markdown), and one top-level <Helmet> for <title>/<style>/<script> and the document\'s DATA: <Value name type default /> scalars and <Query name>{`select … from ref_<datasetId>`}</Query> (SQL over your datasets), bound in the body by name — <Question data="$q">, <DataTable data="$q">, <select value="$x" options="$q">. Recipes/images bind as ref:<id>, and a pdf as <File src="ref:<id>" />. No upload is needed for something already on the web: write <img src="https://…"> (or <Video poster>, <File src>) and publish stores a copy while your URL stays in the document. Dataset creation echoes the inferred columns and a ready-to-paste Query+Question. To ORGANISE: {"format":"folder","title":"Reports"} makes a folder — a folder HAS no content, its page is the listing we render for whoever opens it — and parent_id: "<folderId>" on any create files it there.',
  input: CONTENT_FIELDS,
  annotations: {},
  example: {
    input: { title: 'Q3 report', markup: '<div data-design="tw" className="@container p-8"><h1 className="text-3xl font-bold">Q3</h1></div>', theme: 'industry' },
    note: 'the response carries id, url, edit_id — hand the url to your user',
  },
  errors: [
    { status: 403, code: 'quota_exceeded', fix: 'a cap was reached — either the artifact COUNT for this token, or the stored BYTES for its account (an upload or an imported url); the message names which. Delete what you no longer need' },
    ...CONTENT_ERRORS,
  ],
  async run(ctx, input) {
    return fromResponse(await createArtifactFromBody(input, ctx.actor, ctx.base, ctx.request));
  },
};

const updateArtifactOp: Operation = {
  name: 'update_artifact',
  title: 'Replace an artifact',
  http: { method: 'PUT', path: '/api/artifacts/{id}' },
  description: 'Full replace of an artifact you own (same one-of content fields as create). Archives the current state as a version; the URL never changes. Pass expectedVersion (from get_artifact) to fail with version_conflict instead of overwriting a concurrent edit — on conflict, re-read, merge, and retry with the reported currentVersion. Dataset/recipe refreshes return warnings naming dependent artifacts whose bindings broke. On a FOLDER only title, visibility and parent_id apply, and they apply as METADATA — no new version, nothing archived — because a folder has no content to replace; renaming one is this call, and a content field answers not_editable.',
  input: { id: z.string(), expectedVersion: z.number().int().positive().optional(), ...CONTENT_FIELDS },
  annotations: { idempotent: true },
  example: {
    input: { id: 'aB3xK9', markup: '<div data-design="tw" className="p-8"><h1 className="text-3xl">v2</h1></div>', expectedVersion: 1 },
  },
  errors: [
    NOT_FOUND,
    OWNER_ONLY,
    { status: 409, code: 'version_conflict', fix: 'someone wrote meanwhile — re-read, merge, retry with the reported currentVersion' },
    // A folder has no content, and this door is where that is enforced — so it
    // is declared HERE and not only on edit_artifact. The code is the same word
    // the data tiers answer; the FIX has to be different, because "replace it
    // whole instead" is the thing that just failed.
    { status: 400, code: 'not_editable', fix: 'a folder has no content — send title, visibility or parent_id instead; its page is its listing' },
    ...CONTENT_ERRORS,
  ],
  async run(ctx, input) {
    return fromResponse(await replaceArtifactWithBody(input, ctx.actor, String(input.id), ctx.base, ctx.request));
  },
};

const editArtifactOp: Operation = {
  name: 'edit_artifact',
  title: 'Edit an artifact in place',
  http: { method: 'POST', path: '/api/artifacts/{id}/edits' },
  description: 'Edit part of a markup artifact in place, like a file edit: old_string must appear EXACTLY ONCE in the version named by edit_id, and is replaced by new_string. Pass the edit_id from create/get/edit (never a guess — it proves you read the version you are changing). Edits to DIFFERENT nodes succeed even when someone else changed the document meanwhile; only a change to the SAME node fails, with doc_changed plus the current edit_id and source to rebase on and retry. Prefer this over update_artifact for targeted changes: it is smaller, and it lets a human edit the page live alongside you.',
  input: { id: z.string(), edit_id: z.string(), old_string: z.string(), new_string: z.string() },
  annotations: {},
  example: {
    input: { id: 'aB3xK9', edit_id: '<from your last read>', old_string: 'exact text once in the document', new_string: 'replacement' },
  },
  errors: [
    NOT_FOUND,
    { status: 409, code: 'doc_changed', fix: 'the touched node changed under you — rebase on the returned source + edit_id and retry' },
    { status: 409, code: 'stale_edit_id', fix: 'your edit_id is not the head — take the returned edit_id and source' },
    { status: 400, code: 'bad_diff', fix: 'old_string must appear exactly once — widen it until it is unique' },
    { status: 400, code: 'not_editable', fix: 'only markup artifacts take edits — a data tier is replaced whole, and a folder has no content at all (rename one with update_artifact {title})' },
    INVALID_JSX,
    // An edit re-publishes the whole document, refs included, so it answers
    // this exactly as create and replace do.
    INVALID_REFS,
  ],
  async run(ctx, input) {
    return fromResponse(await respondToEdit(ctx.base, input, (i) => applyEditFor(ctx.actor, String(input.id), i)));
  },
};

const getArtifactOp: Operation = {
  name: 'get_artifact',
  title: 'Read an artifact',
  http: { method: 'GET', path: '/api/artifacts/{id}' },
  description: 'Read one of your artifacts: markup (story JSX) source, dataset rows/columns, or recipe. A markup read also inlines OPEN annotations pinned to nodes of the document. Read them before editing. Each `anchor.key` matches an opaque `data-annotation-anchor` in the markup: preserve that attribute through edits and full rewrites, move it with its content, and never author or change its value. Dropping it orphans the feedback. Reply, resolve, or reopen with the annotate tool. Every read also carries parent_id and ancestor_ids — the folder it sits in, and the whole trail from your root down — so one call draws breadcrumbs. A folder itself reads back with no content: it is a title and a place, and its page is the listing we render.',
  input: { id: z.string() },
  annotations: { readOnly: true },
  example: { input: { id: 'aB3xK9' } },
  errors: [NOT_FOUND],
  async run(ctx, input) {
    const row = await getArtifactFor(ctx.actor, String(input.id));
    if (!row) return reply({ error: 'not_found' }, 404);
    return reply(await artifactToWireWithAnnotations(row, ctx.base) as Record<string, unknown>);
  },
};

const annotateOp: Operation = {
  name: 'annotate',
  title: 'Answer an annotation',
  http: { method: 'POST', path: '/api/artifacts/{id}/annotations/{annotation_id}' },
  description: 'Answer an annotation on a document you own: reply, resolve, or reopen it. A reply may accompany one state transition. Annotations arrive inlined on get_artifact — reply when you act on one, resolve when it is done.',
  input: { id: z.string(), annotation_id: z.string(), reply: z.string().optional(), resolve: z.boolean().optional(), reopen: z.boolean().optional() },
  annotations: {},
  example: { input: { id: 'aB3xK9', annotation_id: 'ann_123', reply: 'done — tightened the intro', resolve: true } },
  errors: [
    NOT_FOUND,
    { status: 400, code: 'invalid_annotation_action', fix: 'send at least one of reply/resolve/reopen, and never resolve with reopen' },
  ],
  async run(ctx, input) {
    return fromResponse(await respondToAnnotationAction(input, ctx.actor, ctx.author, String(input.id), String(input.annotation_id)));
  },
};

const listArtifactsOp: Operation = {
  name: 'list_artifacts',
  title: 'List your artifacts',
  http: { method: 'GET', path: '/api/artifacts' },
  description: 'List your artifacts (newest first): id, title, format, version, url, parent_id, ancestor_ids — no content. Folders are artifacts too — a title and a place, with no content of their own — so they list here beside documents; filter by parent_id (or an empty ancestor_ids for your root) to see one folder\'s contents. A claimed token lists the whole account.',
  input: {},
  annotations: { readOnly: true },
  example: { input: {} },
  errors: [],
  async run(ctx) {
    const rows = await listArtifactsFor(ctx.actor);
    return reply({ artifacts: rows.map((r) => artifactSummaryToWire(r, ctx.base)) });
  },
};

const listVersionsOp: Operation = {
  name: 'list_versions',
  title: 'List an artifact\'s versions',
  http: { method: 'GET', path: '/api/artifacts/{id}/versions' },
  description: 'An artifact\'s version history (every save, newest first), no content — read one with get_version.',
  input: { id: z.string() },
  annotations: { readOnly: true },
  example: { input: { id: 'aB3xK9' } },
  errors: [NOT_FOUND],
  async run(ctx, input) {
    const versions = await listVersionsFor(ctx.actor, String(input.id));
    if (!versions) return reply({ error: 'not_found' }, 404);
    return reply({ versions });
  },
};

const getVersionOp: Operation = {
  name: 'get_version',
  title: 'Read one archived version',
  http: { method: 'GET', path: '/api/artifacts/{id}/versions/{version}' },
  description: 'Read one archived version of an artifact, content included (`markup` carries the source).',
  input: { id: z.string(), version: z.number() },
  annotations: { readOnly: true },
  example: { input: { id: 'aB3xK9', version: 2 } },
  errors: [NOT_FOUND],
  async run(ctx, input) {
    const v = Number(input.version);
    if (!Number.isInteger(v) || v < 1) return reply({ error: 'not_found' }, 404);
    const row = await getVersionFor(ctx.actor, String(input.id), v);
    if (!row) return reply({ error: 'not_found' }, 404);
    // `content` under its own name: `markup` carries the source; the raw
    // `source` field stays off the wire (it was echoed as `html` once, naming
    // a tier that no longer exists).
    return reply({ ...row, markup: row.source, source: undefined } as unknown as Record<string, unknown>);
  },
};

const revertArtifactOp: Operation = {
  name: 'revert_artifact',
  title: 'Revert to an archived version',
  http: { method: 'POST', path: '/api/artifacts/{id}/revert' },
  description: 'Restore an archived version as a NEW head version (the current state is archived first, so reverts are undoable). Answers the fresh edit_id and the restored markup.',
  input: { id: z.string(), version: z.number() },
  annotations: {},
  example: { input: { id: 'aB3xK9', version: 1 } },
  errors: [
    NOT_FOUND,
    { status: 409, code: 'version_not_archived', fix: 'that checkpoint was never archived (save-less edits coalesce) — list_versions shows the real ones' },
    { status: 400, code: 'version_required', fix: 'version must be a positive integer from list_versions' },
  ],
  async run(ctx, input) {
    if (typeof input.version !== 'number' || !Number.isInteger(input.version) || input.version < 1) {
      return reply({ error: 'version_required' }, 400);
    }
    const row = await revertArtifactFor(ctx.actor, String(input.id), input.version);
    // Distinct from not_found: the artifact is yours, that checkpoint just was
    // never archived (save-less edits coalesce). list_versions has the real ones.
    if (isVersionNotArchived(row)) return reply({ error: 'version_not_archived' }, 409);
    if (!row) return reply({ error: 'not_found' }, 404);
    return reply({
      id: row.id, url: `${ctx.base}/a/${row.id}`, version: row.version,
      // Reverting moves the head pointer like any other whole-document write.
      edit_id: row.edit_id, markup: row.source,
    });
  },
};

const deleteArtifactOp: Operation = {
  name: 'delete_artifact',
  title: 'Delete an artifact',
  http: { method: 'DELETE', path: '/api/artifacts/{id}' },
  description: 'Move an artifact to the trash; the link stops working. Nothing is ever erased: it stays recoverable with restore_artifact for good, it still counts against the quota, and destroying it outright is an operator action outside this API. A FOLDER takes everything under it, and restore brings the whole subtree back. If other documents reference it (ref:), the call fails with has_dependents — pass force: true to break those links knowingly (the documents degrade to empty fallbacks).',
  input: { id: z.string(), force: z.boolean().optional() },
  annotations: { destructive: true },
  example: { input: { id: 'aB3xK9' } },
  errors: [
    NOT_FOUND,
    { status: 409, code: 'has_dependents', fix: 'other documents reference this one (they are named) — force: true breaks their refs knowingly' },
  ],
  async run(ctx, input) {
    // Delete protection: breaking other documents' refs must be an informed
    // choice — the refusal names the dependents; force proceeds.
    if (input.force !== true) {
      const dependents = await findDependentsFor(ctx.actor, String(input.id));
      if (dependents.length > 0) {
        return reply({ error: 'has_dependents', dependents: dependents.map((d) => ({ id: d.id, title: d.title })) }, 409);
      }
    }
    // A FOLDER takes its subtree, in the one statement lib/trash runs. There
    // is no second refusal to force past: `folder_not_empty` asked an agent to
    // confirm a permanent act, and this one is not permanent.
    const deleted = await trashArtifactFor(ctx.actor, String(input.id));
    if (!deleted) return reply({ error: 'not_found' }, 404);
    return reply({ ok: true });
  },
};

const restoreArtifactOp: Operation = {
  name: 'restore_artifact',
  title: 'Restore an artifact from the trash',
  http: { method: 'POST', path: '/api/artifacts/{id}/restore' },
  description: 'Take an artifact back out of the trash, at the version it had when it was deleted. A FOLDER brings back everything that was deleted with it. If the folder it used to live in is itself still in the trash, it comes back at your root — the answer says where it landed.',
  input: { id: z.string() },
  annotations: {},
  example: { input: { id: 'aB3xK9' } },
  errors: [
    // The uniform miss, and it covers "already live" too: a row that is not in
    // the trash is not something this door can act on, and saying which would
    // tell a stranger whether the id exists.
    NOT_FOUND,
  ],
  async run(ctx, input) {
    const restored = await restoreArtifactFor(ctx.actor, String(input.id));
    if (!restored) return reply({ error: 'not_found' }, 404);
    return reply({ id: restored.id, url: `${ctx.base}/a/${restored.id}`, parent_id: restored.ancestor_ids.at(-1) ?? null, ancestor_ids: restored.ancestor_ids });
  },
};

const mutateDatasetOp: Operation = {
  name: 'mutate_dataset',
  title: 'Write rows into a dataset',
  http: { method: 'POST', path: '/api/artifacts/{id}/mutate' },
  description: 'Run one INSERT, UPDATE or DELETE against a dataset you own (named as ref_<id> in the SQL, scalars bound via $params in values) — append or fix rows without re-sending the whole table. The dataset must be access: readwrite. Answers the new version and how many rows were affected; documents charting the dataset update live.',
  input: {
    id: z.string(),
    sql: z.string().describe('one INSERT/UPDATE/DELETE naming this dataset as ref_<id>; bind scalars as $name, never interpolate'),
    values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  },
  annotations: {},
  example: { input: { id: 'aB3xK9', sql: 'insert into ref_aB3xK9 (m, v) values ($m, $v)', values: { m: 'Sep', v: 12 } } },
  errors: [
    NOT_FOUND,
    { status: 400, code: 'not_a_dataset', fix: 'only datasets hold rows — this id is another tier' },
    { status: 403, code: 'dataset_read_only', fix: 'set access: readwrite on the dataset first' },
    { status: 400, code: 'invalid_sql', fix: 'one statement, INSERT/UPDATE/DELETE only, naming ref_<id> — the detail says what was wrong' },
    { status: 409, code: 'dataset_full', fix: 'the write would cross the row cap — delete rows or split the dataset' },
    { status: 503, code: 'dataset_busy', fix: 'concurrent writes contended — retry after a moment (Retry-After rides the response)' },
  ],
  async run(ctx, input) {
    return fromResponse(await respondToMutate(ctx.actor, String(input.id), input));
  },
};

const exportArtifactOp: Operation = {
  name: 'export_artifact',
  title: 'Export an artifact as an image',
  http: { method: 'GET', path: '/a/{id}/export' },
  description: 'Render a document you can read as a PNG and return the image — use ONLY if you can actually view images (otherwise read the markup back with get_artifact). For a deck, ask for ONE slide at a time (slide, 1-based): the whole-deck shot stacks every slide too small to read. The same render is served at <base>/a/<id>/export for anyone who can view the document.',
  input: {
    id: z.string(),
    slide: z.number().int().positive().optional().describe('one deck slide, 1-based; omit for the whole document'),
    format: z.enum(['png', 'jpg']).optional(),
  },
  annotations: { readOnly: true },
  example: { input: { id: 'aB3xK9', slide: 2 } },
  errors: [
    NOT_FOUND,
    { status: 404, code: 'slide_not_found', fix: 'past the last slide — the response carries the real count' },
    { status: 503, code: 'render_unavailable', fix: 'this deployment has no headless browser — the HTML link still works' },
  ],
  async run(ctx, input) {
    const artifact = await getArtifactById(String(input.id));
    if (!artifact) return reply({ error: 'not_found' }, 404);
    // The URL's own rule, readable = exportable, applied to the tool's actor:
    // the publishing token reaches its own document directly; a claimed
    // token's account reaches whatever the account may read.
    const viewer = ctx.actor.userId ? { userId: ctx.actor.userId, email: null } : null;
    const authorized = ctx.actor.tokenId === artifact.token_id || (await canReadArtifact(artifact, viewer));
    if (!authorized) return reply({ error: 'not_found' }, 404);
    void trackEvent('export', artifact.id, { userId: ctx.actor.userId ?? null });
    const res = await exportImageResponse(artifact, {
      ...(input.slide !== undefined ? { slide: String(input.slide) } : {}),
      ...(typeof input.format === 'string' ? { format: input.format } : {}),
    }, ctx.base);
    const mime = res.headers.get('Content-Type') ?? '';
    if (!res.ok || !mime.startsWith('image/')) return fromResponse(res);
    return {
      status: 200,
      body: { id: artifact.id, format: mime },
      image: { base64: Buffer.from(await res.arrayBuffer()).toString('base64'), mimeType: mime },
    };
  },
};

/**
 * FORK — take a copy of anything you can READ, as yourself.
 *
 * The reach is the read ACL rather than ownership (the whole point: adapting
 * someone else's public document), so the miss is the same uniform 404 every
 * other operation answers. The copy is re-published as the FORKER
 * (lib/artifacts forkArtifact), which is why a refusal here can name a ref
 * that was fine for the original owner and is not for you — it passes through
 * verbatim rather than copying a document that would be broken on arrival.
 */
const forkArtifactOp: Operation = {
  name: 'fork_artifact',
  title: 'Fork an artifact',
  http: { method: 'POST', path: '/api/artifacts/{id}/fork' },
  description: 'Copy an artifact you can READ — your own, one shared with your account, or any public/unlisted one — into a new artifact of your own at a new id and url. Use it instead of create_artifact when you are adapting a document that already exists: fork it, then edit the copy with edit_artifact. Content, title, theme, template and settings travel; version history, comments and shares do not (the copy is version 1, with its own edit_id). Every ref: image, dataset and recipe is re-validated AS YOU, so a document whose <Mutation> writes someone else\'s dataset, or that reads a private one, is refused by name instead of copied broken. Optional title, visibility and parent_id land on the copy only — the original is never touched. A FOLDER cannot be forked (not_forkable): its source names its own children table, so a copy would list the children of the original. Answers the create reply plus forked_from.',
  input: {
    id: z.string(),
    title: z.string().optional().describe('title for the COPY; omit to keep the original\'s'),
    // The same three values, but NOT the create door's defaults sentence: a
    // fork defaults to whatever the source is, which is the one thing about
    // visibility a forker has to know.
    visibility: CONTENT_FIELDS.visibility.describe("read ACL for the COPY: 'public' = anyone with the link, and it lists on your public profile; 'unlisted' = anyone with the link, listed nowhere; 'private' = you plus the emails you share it with (needs a logged-in account). Omit to keep the source's."),
    parent_id: CONTENT_FIELDS.parent_id.describe("the id of a folder of YOURS to file the COPY under; omit to file it at your root"),
  },
  // A plain write: not destructive (the source is untouched) and NOT
  // idempotent — two calls make two copies.
  annotations: {},
  example: {
    input: { id: 'aB3xK9', title: 'My copy', visibility: 'unlisted' },
    note: 'the reply is create-shaped — take its id and edit_id straight into the edit loop',
  },
  errors: [
    NOT_FOUND,
    { status: 403, code: 'quota_exceeded', fix: 'a cap was reached — either the artifact COUNT for this token, or the stored BYTES for its account (an upload or an imported url); the message names which. Delete what you no longer need' },
    NOT_FORKABLE,
    ...CONTENT_ERRORS,
  ],
  async run(ctx, input) {
    // Validated BEFORE the copy is made, by the same parsers the owner's own
    // doors run — so `private` without an account is the one refusal it has
    // always been, never a silent downgrade of the copy.
    const visibility = parseVisibilityValue(input.visibility, !!ctx.actor.userId);
    if (visibility instanceof Response) return fromResponse(visibility);
    const parent = parseParentField(input);
    if (parent instanceof Response) return fromResponse(parent);
    // The COPY's placement, against the FORKER's own folders — nothing about
    // the source's is carried, because it is somebody else's tree.
    const placement = parent === undefined ? undefined : await resolveParent(ctx.actor, parent, null);
    if (placement && isParentRefusal(placement)) return reply(placement, 400);
    const overrides: ForkOverrides = {
      ...(typeof input.title === 'string' ? { title: input.title } : {}),
      ...(visibility ? { visibility } : {}),
      ...(placement ? { ancestor_ids: placement.ancestor_ids } : {}),
    };

    const source = await getArtifactById(String(input.id));
    if (!source) return reply({ error: 'not_found' }, 404);
    // The export operation's rule, for the same reason: the publishing token
    // reaches its own artifact directly, an account reaches whatever it may
    // read. Unreachable and unknown are one answer.
    const viewer = ctx.actor.userId ? { userId: ctx.actor.userId, email: null } : null;
    if (ctx.actor.tokenId !== source.token_id && !(await canReadArtifact(source, viewer))) {
      return reply({ error: 'not_found' }, 404);
    }

    const copy = await forkArtifact(ctx.actor, source, overrides);
    if (copy instanceof Response) return fromResponse(copy);
    return { status: 201, body: { ...createdArtifactWire(copy, ctx.base, undefined), forked_from: source.id } };
  },
};

/**
 * REFRESH — the way out of "first cached wins".
 *
 * A URL a document names is fetched once and served from our copy forever
 * after, which is right for bytes that almost never change and wrong the day
 * they do. This re-fetches: one URL, or every external URL a document names —
 * the second shape being the one anybody actually wants, since a person knows
 * "this deck's pictures are stale" and not which URLs are in it.
 *
 * Nothing here IMPORTS. A URL nobody has published is reported as
 * `not_cached`: importing is what publishing a document that names it does,
 * and a refresh door that also imported would be a fetch primitive under
 * another name.
 */
const refreshAssetOp: Operation = {
  name: 'refresh_asset',
  title: 'Refresh an imported web asset',
  http: { method: 'POST', path: '/api/artifacts/assets/refresh' },
  description: 'Re-fetch the copy this deployment stores for an external image, font or PDF URL, after the source changed. Pass id to refresh EVERY external url one of your documents names, or url to refresh a single one. Nothing else about the document changes: no new version, no edit_id, and every stored <img src> keeps naming the same url. Answers {refreshed, unchanged, failed}: unchanged means the source really is the same bytes, and failed names each url with a code and a fix (not_cached — nothing is stored for it; rate_limited — this hour\'s fetch allowance is spent, which is counted per url).',
  input: {
    id: z.string().optional().describe('a document of yours: every external url it names is refreshed'),
    url: z.string().optional().describe('one external url to re-fetch; it must already be stored (a document must have named it)'),
  },
  // A write (bytes move) but not destructive, and idempotent: refreshing twice
  // in a row costs a fetch and changes nothing the second time.
  annotations: { idempotent: true },
  example: { input: { id: 'aB3xK9' }, note: 'after the source image behind a url in that document was replaced' },
  errors: [
    NOT_FOUND,
    { status: 400, code: 'nothing_to_refresh', fix: 'pass id (a document of yours) or url (one already-stored url)' },
    // `not_cached` and `rate_limited` are deliberately NOT here: both are
    // per-url reasons inside a 200 body (one url of several may be unknown, or
    // over the hour's fetch allowance), never a refusal of the call.
  ],
  async run(ctx, input) {
    return fromResponse(await refreshAssetsFor(ctx.actor, input));
  },
};

export const OPERATIONS: Operation[] = [
  createArtifactOp, updateArtifactOp, editArtifactOp, forkArtifactOp, getArtifactOp, listArtifactsOp,
  listVersionsOp, getVersionOp, revertArtifactOp, deleteArtifactOp, restoreArtifactOp, annotateOp, mutateDatasetOp,
  exportArtifactOp, refreshAssetOp,
];
