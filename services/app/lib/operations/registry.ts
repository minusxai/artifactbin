import {createHash} from 'node:crypto';
import {queryResourceForRequest} from '@/lib/resource-query';
import type {MutationReceipt} from '@/lib/mutation-receipt';
import {readArtifactSnapshot} from '@/lib/artifact-read';
import {readDatasetPolicy,writeDatasetPolicy} from '@/lib/datasets/policy/http';
import {updateMetadataFromBody} from '@/lib/metadata-wire';
import {decodePage, encodeCursor} from '@/lib/pagination';
import {DATASET_OPERATIONS} from '@/lib/datasets/operations';
import {ACCOUNT_OPERATIONS} from './account';
import {SESSION_OPERATIONS} from './sessions';
/** Shared HTTP operations and schemas, projected into the CLI's bundled API reference.
 * Routes translate HTTP; each operation receives an actor and delegates domain behavior.
 */
import { z } from 'zod';
import { STORY_TEMPLATE_NAMES } from '@/lib/validation/atlas-schemas';
import {
  applyEditFor, canReadArtifact, findDependentsFor, forkArtifact, getArtifactById, getVersionFor, listArtifactPageFor, listVersionPageFor,
  revertArtifactFor, isVersionNotArchived, type ForkOverrides, type TokenActor
} from '@/lib/artifacts';
import { isParentRefusal, resolveParent } from '@/lib/folders';
import { restoreArtifactFor, trashArtifactFor } from '@/lib/trash';
import { trackEvent } from '@/lib/analytics';
import { exportImageResponse } from '@/lib/export';
import type { AnnotationAuthor } from '@/lib/annotations';
import {
  artifactSummaryToWire, artifactToWire, createArtifactFromBody, createdArtifactWire, parseParentField, parseVisibilityValue, replaceArtifactWithBody,
  parseExpectedVersion, refreshAssetsFor, respondToAnnotationAction, respondToEdit, respondToMutate,
} from '@/lib/artifact-wire';
import { MARKUP_FIELD_GUIDANCE, DATASET_FIELD_GUIDANCE, SHEET_URL_FIELD_GUIDANCE, IMAGE_URL_FIELD_GUIDANCE, CSV_URL_FIELD_GUIDANCE, PDF_FIELD_GUIDANCE, PDF_URL_FIELD_GUIDANCE } from '@/lib/agent-guidance';

/** What an operation answers: a status and a JSON body, transport-free. */
export interface OpReply {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  /**
   * Image payload returned as bytes over HTTP. When set, body is ignored on success.
   */
  image?: { base64: string; mimeType: string };
}

/** What every `run` gets: who is calling, from where, and how to attribute them. */
export interface OpContext {
  mutationReceipt?:MutationReceipt;
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
  /** Stable operation identity for registry lookup. */
  name: string;
  title: string;
  http: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string };
  /** ONE model-facing paragraph: what it does, when to use it, what comes back. */
  description: string;
  /** Zod field shape used by validation and the bundled API reference. */
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
 * guidance strings are also rendered in local help.
 */
const CONTENT_FIELDS = {
  markup: z.string().optional().describe(MARKUP_FIELD_GUIDANCE),
  dataset: z.union([z.array(z.record(z.string(), z.unknown())), z.record(z.string(),z.unknown()), z.string()]).optional().describe(DATASET_FIELD_GUIDANCE),
  sheetUrl: z.string().optional().describe(SHEET_URL_FIELD_GUIDANCE),
  columns: z.array(z.object({ name: z.string(), type: z.enum(['string', 'number', 'boolean', 'date']) })).optional().describe('dataset: declared column types (win over inference)'),
  viz: z.record(z.string(), z.unknown()).optional().describe('viz tier: a recipe {description, engine, bindings, params?, template} with {{slot}} tokens'),
  image: z.string().optional().describe('image tier: a base64 data: URL (png|jpeg|webp|gif|svg+xml)'),
  imageUrl: z.string().optional().describe(IMAGE_URL_FIELD_GUIDANCE),
  pdf: z.string().optional().describe(PDF_FIELD_GUIDANCE),
  pdfUrl: z.string().optional().describe(PDF_URL_FIELD_GUIDANCE),
  file: z.object({ filename: z.string(), contentType: z.string(), base64: z.string() }).optional().describe('Allowlisted file uploads (GLB, images, audio/video, documents, fonts, ZIP). Unsupported extensions return unsupported_file_type. Returns a ref:<id> address. Scripts use await artifact.resolve("ref:<id>"); private files never resolve. For large files POST raw bytes to /api/artifacts?format=file&filename=<name>.'),
  csvUrl: z.string().optional().describe(CSV_URL_FIELD_GUIDANCE),
  title: z.string().optional(),
  description: z.string().optional().describe('shown on the owner dashboard, never on the document'),
  // A string, NOT an enum: the publish pipeline owns theme validation, and its
  // rejections carry the vocabulary an agent needs (`allowed` for an unknown
  // name, the successor hint for a retired one). A zod enum would swallow both
  // into a generic schema error.
  theme: z.string().optional().describe('design personality (fonts, radius, light+dark palettes): modernist | organic | industry | terminal | manuscript | pop; a retired name (classical/broadsheet/nocturne) is rejected with a hint naming its successor'),
  template: z.enum(STORY_TEMPLATE_NAMES).optional(),
  colorMode: z.enum(['light', 'dark']).optional().describe("the AUTHOR's default mode; every theme has both palettes and readers can flip at view time"),
  // A FOLDER IS AN ARTIFACT, so the create door's `format` takes exactly one
  // value: everything else is named by its content field, and only a folder
  // has none.
  format: z.enum(['folder']).optional().describe("a folder: send it with NO content field. A folder is an artifact like any other — it has a url, visibility and sharing — and you file documents under it with parent_id"),
  parent_id: z.string().nullable().optional().describe("the id of a FOLDER artifact to file this under (create one with {\"format\":\"folder\",\"title\":\"…\"}), or null for your root. Ids, never paths: two sibling folders may share a name. The URL keeps working wherever the file moves"),
  shares: z.array(z.object({email:z.string(),role:z.enum(['viewer','commenter','editor'])})).max(100).optional().describe('Explicit sharing list; omission preserves it and an empty list clears it atomically with content.'),
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
 * Folder placement is owner-scoped and answers them the uniform
 * 404 instead, which is why this code exists on exactly one door.
 */
const OWNER_ONLY: OperationError = { status: 403, code: 'owner_only', fix: "folder placement requires ownership; editors may change sharing and dataset data policies" };

const NOT_FORKABLE: OperationError = { status: 400, code: 'not_forkable', fix: "a folder cannot be forked — create your own with {\"format\":\"folder\"} and file documents under it with parent_id. A Postgres dataset must have a usable connection" };

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
  description: 'Create an artifact (exactly one of markup | dataset | viz | image | pdf | file). Returns the public URL. markup is THE document format: story JSX over the component kit, HTML tags for everything else (prose is ordinary <p>/<h1>/<ul> — there is no markdown), and one top-level <Helmet> for <title>/<style>/<script> and the document\'s DATA: <Value name type default /> scalars and <Query name source="ref:<id>">{`select … from public.rows`}</Query> (SQL over named tables in one dataset; PostgreSQL datasets are read-only), bound in the body by name — <Question data="$q">, <DataTable data="$q">, <select value="$x" options="$q">. Recipes/images bind as ref:<id>, and a pdf as <File src="ref:<id>" />. No upload is needed for something already on the web: write <img src="https://…"> (or <Video poster>, <File src>) and publish stores a copy while your URL stays in the document. Dataset creation echoes the inferred columns and a ready-to-paste Query+Question. To ORGANISE: {"format":"folder","title":"Reports"} makes a folder — a folder HAS no content, its page is the listing we render for whoever opens it — and parent_id: "<folderId>" on any create files it there.',
  input: { ...CONTENT_FIELDS, forked_from: z.string().optional().describe("the id of the artifact this one was copied from, when you built the copy yourself instead of calling fork_artifact — it must be an artifact you can READ, and it is recorded once here and never editable afterwards") },
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
  description: 'Full replace of an artifact you own (same one-of content fields as create). Archives the current state as a version; the URL never changes. Both expectedVersion and expectedState from the observed head are required. A changed version or metadata state refuses the write; inspect the current head, merge and retry with its conditions. Dataset/recipe refreshes return warnings naming dependent artifacts whose bindings broke. On a FOLDER only title, visibility and parent_id apply, and they apply as METADATA — no new version, nothing archived — because a folder has no content to replace; renaming one is this call, and a content field answers not_editable.',
  input: { id: z.string(), expectedVersion: z.number().int().positive(), expectedState: z.string().regex(/^[a-f0-9]{64}$/), ...CONTENT_FIELDS },
  annotations: { idempotent: true },
  example: {
    input: { id: 'aB3xK9', markup: '<div data-design="tw" className="p-8"><h1 className="text-3xl">v2</h1></div>', expectedVersion: 1, expectedState: 'a'.repeat(64) },
  },
  errors: [
    NOT_FOUND,
    OWNER_ONLY,
    { status: 409, code: 'version_conflict', fix: 'someone wrote meanwhile — re-read, merge, retry with the observed currentVersion and currentState' },
    // A folder has no content, and this door is where that is enforced — so it
    // is declared HERE and not only on edit_artifact. The code is the same word
    // the data tiers answer; the FIX has to be different, because "replace it
    // whole instead" is the thing that just failed.
    { status: 400, code: 'not_editable', fix: 'a folder has no content — send title, visibility or parent_id instead; its page is its listing' },
    ...CONTENT_ERRORS,
  ],
  async run(ctx, input) {
    return fromResponse(await replaceArtifactWithBody(input, ctx.actor, String(input.id), ctx.base));
  },
};

const editArtifactOp: Operation = {
  name: 'edit_artifact',
  title: 'Edit an artifact in place',
  http: { method: 'POST', path: '/api/artifacts/{id}/edits' },
  description: 'Edit markup using source (a complete proposed JSX body), one old_string/new_string pair OR an edits list of 1–64 pairs; exactly one input form. Each old_string must match EXACTLY ONCE against the evolving in-memory source. Only the final document is validated and committed: one version or nothing; failures identify zero-based edit_index. Use the edit_id from your last create/get/edit response. Preserve persistent ids when moving nodes; include the nearest id-bearing context to distinguish repeated text. Unrelated concurrent edits rebase; conflicting regions return doc_changed with the current edit_id and source. Prefer this targeted operation over update_artifact, which replaces the whole document.',
  input: {
    id: z.string(), edit_id: z.string(),
    source: z.string().optional().describe("The complete proposed JSX body; use instead of old_string/new_string or edits. The edit_id identifies its base for conservative rebase."),
    old_string: z.string().optional(), new_string: z.string().optional(),
    edits: z.array(z.object({ old_string: z.string(), new_string: z.string() })).min(1).max(64).optional(),
  },
  annotations: {},
  example: {
    input: { id: 'aB3xK9', edit_id: '<from your last read>', old_string: 'exact text once in the document', new_string: 'replacement' },
  },
  errors: [
    NOT_FOUND,
    { status: 409, code: 'doc_changed', fix: 'the touched node changed under you — rebase on the returned source + edit_id and retry' },
    { status: 409, code: 'stale_edit_id', fix: 'your edit_id is not the head — take the returned edit_id and source' },
    { status: 400, code: 'bad_diff', fix: 'Read current stored markup. old_string must match it exactly once; a rejected write changed nothing.' },
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
  description: 'Read markup source, dataset rows/columns, or a recipe, plus edit_id, parent_id and ancestor_ids. Markup reads inline OPEN annotations; inspect them before editing. anchor.nodeId identifies a persistent body id: preserve ids through edits and full rewrites, and move them with their nodes. Comments are relations and never rewrite source or flush the editor. Legacy data-annotation-anchor attributes are read compatibility only; do not author them. Reply, resolve or reopen with annotate. A folder has no content: its page is a viewer-scoped listing.',
  input: { id: z.string() },
  annotations: { readOnly: true },
  example: { input: { id: 'aB3xK9' } },
  errors: [NOT_FOUND],
  async run(ctx, input) {
    const snapshot = await readArtifactSnapshot(ctx.actor,String(input.id),ctx.base);
    return snapshot ? reply(snapshot) : reply({error:'not_found'},404);
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
    return fromResponse(await respondToAnnotationAction(input, ctx.actor, ctx.author, String(input.id), String(input.annotation_id),ctx.mutationReceipt));
  },
};

const listArtifactsOp: Operation = {
  name: 'list_artifacts',
  title: 'List your artifacts',
  http: { method: 'GET', path: '/api/artifacts' },
  description: 'List your artifacts (newest first): id, title, format, version, url, parent_id, ancestor_ids — no content. Folders are artifacts too — a title and a place, with no content of their own — so they list here beside documents; filter by parent_id (or an empty ancestor_ids for your root) to see one folder\'s contents. A claimed token lists the whole account.',
  input: { limit: z.number().int().min(1).max(100).optional(), cursor: z.string().optional(),type:z.enum(['artifact','folder','dataset','file']).optional(),visibility:z.enum(['private','unlisted','public']).optional(),relationship:z.enum(['all','owned','shared']).optional(),search:z.string().optional(),parent_id:z.string().optional() },
  annotations: { readOnly: true },
  example: { input: {} },
  errors: [],
  async run(ctx, input) {
    const page = decodePage(input, 'artifacts');
    if (page instanceof Response) return fromResponse(page);
    for(const [key,allowed] of Object.entries({type:['artifact','folder','dataset','file'],visibility:['private','unlisted','public'],relationship:['all','owned','shared']}))if(input[key]!==undefined&&!allowed.includes(String(input[key])))return reply({error:'invalid_filter',field:key},400);
    if(input.parent_id!==undefined&&(typeof input.parent_id!=='string'||!/^[A-Za-z0-9]{6,12}$/.test(input.parent_id)))return reply({error:'invalid_container'},400);
    if(input.search!==undefined&&(typeof input.search!=='string'||input.search.length>1000))return reply({error:'invalid_filter',field:'search'},400);
    const filters={...(input.type?{type:input.type as 'artifact'|'folder'|'dataset'|'file'}:{}),...(input.visibility?{visibility:input.visibility as 'private'|'unlisted'|'public'}:{}),relationship:(input.relationship??'all') as 'all'|'owned'|'shared',...(input.search?{search:String(input.search)}:{}),...(input.parent_id?{parent_id:String(input.parent_id)}:{})};
    const scope=createHash('sha256').update(JSON.stringify([ctx.actor.userId??ctx.actor.tokenId,filters])).digest('hex');
    if(page.cursor&&page.cursor.scope!==scope)return reply({error:'invalid_cursor',hint:'Restart this collection without --cursor; the filters changed.'},400);
    const result = await listArtifactPageFor(ctx.actor, page.limit, page.cursor as {created: string; id: string} | undefined,filters);
    return reply({ artifacts: result.rows.map((r) => artifactSummaryToWire(r, ctx.base)), next_cursor: result.next ? encodeCursor('artifacts', {...result.next,scope}) : null });
  },
};

const listVersionsOp: Operation = {
  name: 'list_versions',
  title: 'List an artifact\'s versions',
  http: { method: 'GET', path: '/api/artifacts/{id}/versions' },
  description: 'An artifact\'s version history (every save, newest first), no content — read one with get_version.',
  input: { id: z.string(), limit: z.number().int().min(1).max(100).optional(), cursor: z.string().optional(), version: z.number().int().positive().optional(), author: z.string().optional().describe('only versions saved by this username'), since: z.string().optional().describe('ISO-8601 lower bound on the save time'), until: z.string().optional().describe('ISO-8601 upper bound on the save time') },
  annotations: { readOnly: true },
  example: { input: { id: 'aB3xK9' } },
  errors: [NOT_FOUND],
  async run(ctx, input) {
    const page = decodePage(input, 'versions');
    for(const key of ['since','until'])if(input[key]!==undefined&&(typeof input[key]!=='string'||!Number.isFinite(Date.parse(String(input[key])))))return reply({error:'invalid_filter',field:key,hint:'Use an ISO-8601 timestamp.'},400);
    if(input.author!==undefined&&typeof input.author!=='string')return reply({error:'invalid_filter',field:'author'},400);
    if (page instanceof Response) return fromResponse(page);
    const version=input.version===undefined?undefined:Number(input.version);
    if(version!==undefined&&(!Number.isSafeInteger(version)||version<1))return reply({error:'invalid_version',hint:'Use a positive integer version.'},400);
    const result = await listVersionPageFor(ctx.actor, String(input.id), page.limit, page.cursor?.version as number | undefined,version,{author:input.author as string|undefined,since:input.since as string|undefined,until:input.until as string|undefined});
    if (!result) return reply({ error: 'not_found' }, 404);
    return reply({ versions: result.rows, next_cursor: result.next ? encodeCursor('versions', {version: result.next}) : null });
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

const updateMetadataOp: Operation = {
 name:'update_metadata', title:'Update metadata without a content version', http:{method:'PATCH',path:'/api/artifacts/{id}'},
 description:'Change only the supplied metadata fields, conditional on expectedState from the observed head. Omitted fields stay unchanged; null clears nullable fields. This does not archive content or change version/edit_id. Sharing and folder placement require ownership. The response is the complete canonical artifact, including its new state.',
 input:{id:z.string(),expectedState:z.string().regex(/^[a-f0-9]{64}$/),expectedVersion:z.number().int().positive().optional(),
  title:z.string().nullable().optional(),description:z.string().nullable().optional(),theme:z.string().nullable().optional(),template:z.string().nullable().optional(),colorMode:z.enum(['light','dark']).nullable().optional(),
  visibility:z.enum(['public','unlisted','private']).optional(),linkRole:z.enum(['viewer','commenter','editor']).optional(),parent_id:z.string().nullable().optional(),access:z.enum(['read','readwrite']).optional(),
  shares:CONTENT_FIELDS.shares,policy:z.record(z.string(),z.unknown()).nullable().optional(),expectedPolicyRevision:z.number().int().min(0).optional()},
 annotations:{},example:{input:{id:'aB3xK9',title:'Updated title',expectedState:'a'.repeat(64)}},
 errors:[NOT_FOUND,OWNER_ONLY,{status:400,code:'state_required',fix:'Read the current artifact and send its state as expectedState.'},{status:409,code:'state_conflict',fix:'Read the current metadata, reconcile your changes and retry with the new state.'}],
 async run(ctx,input){const {id,...body}=input;return fromResponse(await updateMetadataFromBody(ctx.actor,String(id),body,ctx.base));},
};

const revertArtifactOp: Operation = {
  name: 'revert_artifact',
  title: 'Revert to an archived version',
  http: { method: 'POST', path: '/api/artifacts/{id}/revert' },
  description: 'Restore an archived version as a NEW head version (the current state is archived first, so reverts are undoable). Answers the complete canonical head, including restored markup, metadata, edit_id and state for the next conditional write.',
  input: { id: z.string(), version: z.number(), expectedVersion: z.number().int().positive(), expectedState: z.string().regex(/^[a-f0-9]{64}$/) },
  annotations: {},
  example: { input: { id: 'aB3xK9', version: 1, expectedVersion: 2, expectedState: 'a'.repeat(64) } },
  errors: [
    NOT_FOUND,
    { status: 409, code: 'version_not_archived', fix: 'that checkpoint was never archived (save-less edits coalesce) — list_versions shows the real ones' },
    { status: 400, code: 'version_required', fix: 'version must be a positive integer from list_versions' },
  ],
  async run(ctx, input) {
    if (typeof input.version !== 'number' || !Number.isInteger(input.version) || input.version < 1) {
      return reply({ error: 'version_required' }, 400);
    }
    const expected = parseExpectedVersion(input);
    if (expected instanceof Response) return fromResponse(expected);
    const row = await revertArtifactFor(ctx.actor, String(input.id), input.version, expected);
    // Distinct from not_found: the artifact is yours, that checkpoint just was
    // never archived (save-less edits coalesce). list_versions has the real ones.
    if (isVersionNotArchived(row)) {
      if(row.refusal) return fromResponse(row.refusal);
      if(row.conflictVersion!==undefined) return reply({error:'version_conflict',currentVersion:row.conflictVersion},409);
      return reply({ error: 'version_not_archived' }, 409);
    }
    if (!row) return reply({ error: 'not_found' }, 404);
    return reply(await artifactToWire(row,ctx.base));
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
    return reply({ ok: true, deleted_ids:deleted });
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

const getDatasetPolicyOp: Operation = {
  name:'get_dataset_policy', title:'Read dataset access policies',
  http:{method:'GET',path:'/api/artifacts/{id}/policy'},
  description:'Inspect a dataset you own or can edit: Hasura-style write permissions for everyone with dataset access, current policy revision, table columns and dependent actions. Policies constrain writes; they do not filter reads.',
  input:{id:z.string()}, annotations:{readOnly:true},example:{input:{id:'aB3xK9'}},errors:[NOT_FOUND],
  async run(ctx,input){return fromResponse(await readDatasetPolicy(ctx.actor,String(input.id)));},
};
const setDatasetPolicyOp: Operation = {
  name:'set_dataset_policy',title:'Set dataset access policies',
  http:{method:'PUT',path:'/api/artifacts/{id}/policy'},
  description:'Editors and owners: replace version 1 dataset write policy with revision compare-and-swap. Use Hasura insert_permissions/update_permissions/delete_permissions entries with role, permission, columns, filter, check and set. Use role viewer for everyone with dataset view access, including commenters, editors and owners. Sharing controls the audience; there is no separate mutation grant. Unsupported fields fail explicitly. Set policy to null to restore legacy editor-only writes.',
  input:{id:z.string(),policy:z.record(z.string(),z.unknown()).nullable(),expectedPolicyRevision:z.number().int().min(0)},
  annotations:{},example:{input:{id:'aB3xK9',expectedPolicyRevision:0,policy:{version:1,enforcement:'enabled',tables:[]}}},
  errors:[NOT_FOUND,{status:400,code:'invalid_policy',fix:'correct the field identified in detail'},{status:409,code:'policy_changed',fix:'read the current policy and revision before saving'}],
  async run(ctx,input){return fromResponse(await writeDatasetPolicy(ctx.actor,String(input.id),input));},
};

const mutateDatasetOp: Operation = {
  name: 'mutate_dataset',
  title: 'Write rows into a dataset',
  http: { method: 'POST', path: '/api/artifacts/{id}/mutate' },
  description: 'Run one INSERT, UPDATE or DELETE against a dataset you own (selected by the path ID; SQL names a catalog table such as public.rows, scalars bound via $params in values) — append or fix rows without re-sending the whole table. The dataset must be access: readwrite. Answers the new version and how many rows were affected; documents charting the dataset update live.',
  input: {
    id: z.string(),
    sql: z.string().optional().describe('one INSERT/UPDATE/DELETE naming a catalog table such as public.rows; bind scalars as $name, never interpolate'),
    name: z.string().optional().describe('instead of sql: a mutation the document declares by name; the id is then the document, and values bind its $params'),
    values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  },
  annotations: {},
  example: { input: { id: 'aB3xK9', sql: 'insert into public.rows (m, v) values ($m, $v)', values: { m: 'Sep', v: 12 } } },
  errors: [
    NOT_FOUND,
    { status: 400, code: 'not_a_dataset', fix: 'only datasets hold rows — this id is another tier' },
    { status: 403, code: 'dataset_read_only', fix: 'set access: readwrite on the dataset first' },
    { status: 400, code: 'invalid_sql', fix: 'one statement, INSERT/UPDATE/DELETE only, naming a catalog table such as public.rows — the detail says what was wrong' },
    { status: 409, code: 'dataset_full', fix: 'the write would cross the row cap — delete rows or split the dataset' },
    { status: 503, code: 'dataset_busy', fix: 'concurrent writes contended — retry after a moment (Retry-After rides the response)' },
  ],
  async run(ctx, input) {
    return fromResponse(await respondToMutate(ctx.actor, String(input.id), input,ctx.mutationReceipt));
  },
};

const exportArtifactOp: Operation = {
  name: 'export_artifact',
  title: 'Export an artifact as an image',
  http: { method: 'GET', path: '/api/artifacts/{id}/export' },
  description: 'Render a document you can read as a PNG and return the image — use ONLY if you can actually view images (otherwise read the markup back with get_artifact). For a deck, ask for ONE slide at a time (slide, 1-based): the whole-deck shot stacks every slide too small to read. The same render is served at <base>/a/<id>/export for anyone who can view the document.',
  input: {
    id: z.string(),
    slide: z.number().int().positive().optional().describe('one deck slide, 1-based; omit for the whole document'),
    format: z.enum(['png', 'jpg']).optional(),
    mode: z.enum(['full','card','preview']).optional().describe('Capture mode; defaults to full.'),
    crop: z.string().optional().describe('Card crop selection.'),
    image: z.string().optional().describe('Card image selection.'),
    search: z.string().optional().describe('Capture search selection.'),
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
      ...Object.fromEntries(['mode','crop','image','search'].filter(key=>typeof input[key]==='string').map(key=>[key,input[key] as string])),
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
  description: 'Copy an artifact you can READ — your own, one shared with your account, or any public/unlisted one — into a new artifact of your own at a new id and url. Use it instead of create_artifact when you are adapting a document that already exists: fork it, then edit the copy with edit_artifact. Content, title, theme, template and settings travel; version history, comments and shares do not (the copy is version 1, with its own edit_id). Every ref: image, dataset and recipe is re-validated AS YOU, so a document whose <Mutation> writes someone else\'s dataset, or that reads a private one, is refused by name instead of copied broken. Optional title, visibility and parent_id land on the copy only — the original is never touched. Folders and live Postgres datasets are not forkable: a folder source names the original children, while a Postgres secret remains bound to the original dataset. Answers the create reply plus forked_from.',
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

const queryResourceOp:Operation={
 name:'query_resource',title:'Query dataset rows or declared document queries',http:{method:'POST',path:'/api/artifacts/{id}/query'},
 description:'Read bounded dataset SQL or selected declared document queries, with scalar parameters and state-bound pagination. Never mutates rows.',
 input:{id:z.string(),sql:z.string().optional(),name:z.string().optional(),values:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).optional(),limit:z.number().int().min(1).max(100).optional(),cursor:z.string().optional(),refresh:z.boolean().optional()},
 annotations:{readOnly:true},example:{input:{id:'aB3xK9',limit:20}},
 errors:[NOT_FOUND,{status:400,code:'invalid_sql',fix:'the statement was refused — the message names the reason (an undeclared $parameter, a disallowed function, unsupported syntax); fix the SQL or pass the parameter with --param'}],
 async run(ctx,input){const {id,...body}=input;return fromResponse(await queryResourceForRequest(ctx.actor,String(id),body,ctx.request));},
};

export const OPERATIONS: Operation[] = [
  ...DATASET_OPERATIONS,...ACCOUNT_OPERATIONS,...SESSION_OPERATIONS,queryResourceOp,
  createArtifactOp, updateArtifactOp, editArtifactOp, forkArtifactOp, getArtifactOp, listArtifactsOp,
  listVersionsOp, getVersionOp, updateMetadataOp, revertArtifactOp, deleteArtifactOp, restoreArtifactOp, annotateOp, getDatasetPolicyOp, setDatasetPolicyOp, mutateDatasetOp,
  exportArtifactOp, refreshAssetOp,
];
