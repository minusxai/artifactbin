/**
 * THE PUBLISH REQUESTS — create, replace and asset refresh, the use cases both
 * auth modes and the operations registry run over one pipeline. Story owns the
 * content pipeline they drive (prepareContentInput, the web-asset cache, the
 * data checks); lib/artifacts owns the storage, the access rules and the wire
 * shapes they answer with (artifacts/wire: the create and replace echoes, the
 * body parsers and the folder placement), so this module calls down into
 * artifacts and nothing in artifacts calls up into it.
 */
import { applyEditFor, type ArtifactInput, artifactQuotaExceeded, type ArtifactRow, artifactState, byteQuotaFor, canReadArtifact, committedOpenAnnotations, createArtifact, createdArtifactWire, creationOperation, CreationReplay, findDependentsFor, getArtifactById, getArtifactFor, getOwnedArtifactFor, isVersionConflict, lookupCreation, parseAccessValue, parseExpectedVersion, parseLinkRoleValue, parseParentField, parseShareEntries, parseVisibilityValue, placementFor, refLoaderForActor, replaceArtifactFor, replacedArtifactWire, respondToEdit, rowToResolvedRef, setMetadataFor, sourceRepairsEcho, writerFor } from '@/lib/artifacts';
import { CONTENT_FIELDS, type DatasetAccess, type Visibility } from '@artifactbin/contracts';
import type { TokenActor } from '@/lib/accounts';
import { parseAnnotationOperations } from '@/lib/document/annotation-edits';
import { normalizeNodeIds } from '@/lib/document/node-ids';
import { collectExternalAssetUrls } from '@/lib/document/external-images';
import { prepareCatalog, catalogOf } from '@/lib/datasets/catalog';
import { DatasetError } from '@/lib/datasets/errors';
import type { ServerRefLoader } from '@/lib/datasets/schema-loader';
import { json, readJson } from '@/lib/http/http';
import { ID_RE } from '@/lib/platform/ids-shape';
import { getDb } from '@/lib/platform/db';
import { prepareContentInput, applyPreparedContent, type PreparedContent } from '../prepared/prepare-content';
import { lookupWebAssets, refreshWebAssets, type WebAssetImporter } from '../assets/web-assets';
import { checkDocumentData } from '../data/data-checks';

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
  options: {dryRun?:boolean} = {},
): Promise<Response> {
  if (!body) return json({ error: 'invalid_json' }, 400);
  if(Object.hasOwn(body,'document_update'))return respondToEdit(base,body,input=>applyEditFor(actor,id,input,options));
  if(typeof body.markup==='string')return json({error:'jsonb_operations_required',hint:'Submit document_update using the current CLI or browser editor.'},400);
  // The row FIRST: refs and imports resolve as the DOCUMENT's owner, never as
  // the writer — an editor (artifact_shares.role) replacing a document that
  // carries its owner's <Mutation> or private image must not fail on assets
  // they could never own. Unreachable is the uniform 404, before any parse.
  const current = await getArtifactFor(actor, id);
  if (!current) return json({ error: 'not_found' }, 404);
  if(Object.hasOwn(body,'policy')||Object.hasOwn(body,'expectedPolicyRevision'))return json({error:'combined_policy_write',hint:'Publish content first, then change policy in the dataset YAML without replacing content.'},400);
  // Sharing settings use edit access; filing under an owner's folder still checks placement.
  const owned = body.parent_id !== undefined ? await getOwnedArtifactFor(actor, id) : null;
  const owner = writerFor(current);
  const sentMarkup = body.markup;
  const annotationOps=body.annotation_ops===undefined?[]:parseAnnotationOperations(body.annotation_ops);
  if(!annotationOps||annotationOps.length&&typeof sentMarkup!=='string')return json({error:'invalid_annotation_operations'},400);
  const expected = parseExpectedVersion(body);
  if (expected instanceof Response) return expected;
  let normalizeMarkup: ((source: string) => ReturnType<typeof normalizeNodeIds>) | undefined;
  if(typeof body.markup==='string') {
    const db=await getDb();
    const lifetime=await db.query<{source_id:string}>('SELECT source_id FROM artifact_source_ids WHERE artifact_id=$1',[current.id]);
    normalizeMarkup = source => normalizeNodeIds(source,{previousSource:current.source,reservedIds:lifetime.rows.map(row=>row.source_id)});
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
      return json({ error: 'not_editable', details: ['a folder has no content — its page is its listing. Only title, visibility and folder are editable, in the folder YAML you push'] }, 400);
    }
  }
  const prepared: PreparedContent | Response = current.format === 'folder'
    ? {content: { format: 'folder', source: '', meta: {}, derivedTitle: null }, objects: []}
    : await prepareContentInput({...(current.format==='dataset'?{columns:((current.meta.columns??[]) as import('@artifactbin/contracts').DatasetColumn[]).filter(c=>c.type==='user')}:{}),theme:current.meta.theme,template:current.meta.template,colorMode:current.meta.colorMode,...body}, {
      prepareDataset: (input,objects) => prepareCatalog(input,actor,current,objects),
      normalizeMarkup,
      loadRef: refLoaderForActor(owner),
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
  const placement = await placementFor(writerFor(current), parent, { id: current.id, format: current.format }, !!owned);
  if (placement instanceof Response) return placement;

  if (expected.expectedVersion !== undefined && expected.expectedVersion !== current.version || expected.expectedState !== undefined && expected.expectedState !== artifactState(current)) {
    return json({error:expected.expectedVersion !== undefined && expected.expectedVersion !== current.version?'version_conflict':'state_conflict',currentVersion:current.version,currentState:artifactState(current)},409);
  }
  if (options.dryRun) return preflightReply(prepared);

  const applied = await applyPreparedContent(prepared);
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
  let row;
  try { row = current.format === 'folder'
    ? await setMetadataFor(actor, id, {
      ...(shares!==undefined?{shares}:{}),
      ...(body.title===null || typeof body.title === 'string' ? { title: body.title } : {}),
      ...(visibility ? { visibility } : {}),
      ...(placement ? { ancestor_ids: placement.ancestor_ids } : {}),
    }, expected)
    : await replaceArtifactFor(actor, id, input, {...expected,annotationOps,shares});
  } catch(error) {if(error instanceof DatasetError)return json({error:"dataset_error",details:[error.message]},error.status);throw error;}
  // A refusal the replace composed for itself — `policy_locked` (409) or
  // `policy_mismatch` (400). It exists so this door stops answering the
  // uniform 404 below for a governed dataset the caller is looking straight
  // at; it is already the answer, and is not re-worded here.
  if (row instanceof Response) return row;
  if (isVersionConflict(row)) return json({ error: row.reason ?? 'version_conflict', currentVersion: row.currentVersion, ...(row.currentState ? {currentState:row.currentState} : {}) }, 409);
  if (!row) return json({ error: 'not_found' }, 404);

  // Dataset/viz refresh: warn about dependents whose bindings no longer
  // resolve (warnings, never blocks).
  const warnings = await refreshWarningsFor(actor, row);
  const affected = ['dataset','image','pdf','file'].includes(row.format) ? await findDependentsFor(actor,row.id) : null;
  return json(await replacedArtifactWire(row, base, sentMarkup, { affected, warnings, repairs: parsed.repairs, openAnnotations: committedOpenAnnotations(row) }));
}

/**
 * The JSON create pipeline — one implementation for the bearer route and the
 * operations registry (lib/operations). The HTTP route keeps one
 * transport-only branch of its own: a raw `Content-Type: image/*` body, which
 * has no JSON envelope for this function to read.
 */
export async function createArtifactFromBody(
  body: Record<string, unknown>,
  actor: TokenActor,
  base: string,
  request?: Request,
  options: {dryRun?:boolean} = {},
): Promise<Response> {
  if(body.reserved_id!==undefined&&(typeof body.reserved_id!=='string'||!ID_RE.test(body.reserved_id)))return json({error:'invalid_reserved_id'},400);
  if(Object.hasOwn(body,'policy')||Object.hasOwn(body,'expectedPolicyRevision'))return json({error:'combined_policy_write',hint:'Publish the dataset first, pull its YAML, then change its policy.'},400);
  // LINEAGE. A fork is made locally — a draft with the source's identity stripped
  // and `forked_from` recorded — and its FIRST create presents that id here. The
  // claim is checked, not trusted: provenance may only name a source this actor
  // can actually read, by the same rule `fork_artifact` and the export door use,
  // and unreachable is unknown. Written once at creation; no later write touches it.
  let forkedFrom: string | undefined;
  if (body.forked_from !== undefined && body.forked_from !== null) {
    if (typeof body.forked_from !== 'string' || !ID_RE.test(body.forked_from)) return json({ error: 'invalid_metadata', hint: 'forked_from is the id of the artifact this copy came from.' }, 400);
    const source = await getArtifactById(body.forked_from);
    const viewer = actor.userId ? { userId: actor.userId, email: null } : null;
    if (!source || (actor.tokenId !== source.token_id && !(await canReadArtifact(source, viewer)))) return json({ error: 'not_found', hint: 'forked_from must name an artifact you can read.' }, 404);
    forkedFrom = source.id;
  }
  let responseBody: ((row: ArtifactRow) => Record<string,unknown>) = row => createdArtifactWire(row,base,body.markup);
  let operation;
  try {operation = await creationOperation(actor,base,request?.headers.get('Idempotency-Key'),body,row=>({status:201,body:responseBody(row)}),request?.headers.get('X-Artifactbin-Account'));}
  catch(error){if(error instanceof CreationReplay)return json(error.reply.body,error.reply.status);throw error;}
  if(operation){const replay=await lookupCreation(await getDb(),operation);if(replay)return json(replay.body,replay.status);}
  if (await artifactQuotaExceeded(actor.tokenId)) return json({ error: 'quota_exceeded', details: ['this token has hit its artifact COUNT quota — deleting does not free it (nothing is erased), so ask your user for another token'] }, 403);
  const shares=parseShareEntries(body.shares);if(shares instanceof Response)return shares;
  if(body.visibility===null||body.linkRole===null)return json({error:'invalid_metadata',hint:'visibility and linkRole cannot be null.'},400);
  const link=parseLinkRoleValue(body.linkRole);if(link instanceof Response)return link;
  const sentMarkup=body.markup;
  const prepared = await prepareContentInput(body, {
    normalizeMarkup: source => normalizeNodeIds(source),
    creating: true,
    prepareDataset: (input,objects) => prepareCatalog(input,actor,undefined,objects),
    loadRef: refLoaderForActor(actor),
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
  const placement = (await placementFor(actor, parent, null)) ?? { ancestor_ids: [] };
  if (placement instanceof Response) return placement;

  if (options.dryRun) return preflightReply(prepared);

  const applied = await applyPreparedContent(prepared);
  parsed = applied;
  responseBody = row => ({...createdArtifactWire(row,base,sentMarkup),...sourceRepairsEcho(parsed.repairs)});
  let row;
  try{row = await createArtifact(actor.tokenId, actor.userId, {
    ...parsed,
    title: body.title===null || typeof body.title === 'string' ? body.title : parsed.derivedTitle,
    description: body.description===null || typeof body.description === 'string' ? body.description : null,
    ...(visibility ? { visibility } : {}),
    ...(access ? { access } : {}),
    ancestor_ids: placement.ancestor_ids,
  }, {reservedId:body.reserved_id as string|undefined,operation,shares,...(link?{linkRole:link}:{}),...(forkedFrom?{forkedFrom}:{})});}catch(error){if(error instanceof CreationReplay)return json(error.reply.body,error.reply.status);if(error instanceof DatasetError)return json({error:'dataset_error',details:[error.message]},error.status);throw error;}
  return json(responseBody(row), 201);
}


/**
 * REFRESH — one pipeline, two doors (the `refresh_asset` operation and the
 * owner's menu row), because a bearer agent and a person clicking a menu must
 * not be able to mean different things by it.
 *
 * `url` refreshes one URL we hold. `id` refreshes every external URL a DOCUMENT
 * names that we hold a copy of — the shape a person actually wants ("this deck's
 * pictures are stale"), and the one an agent can call without first knowing
 * which URLs are in there. Publish copies nothing (a written URL is served as
 * written), so a copy exists only where a reader's view asked for one
 * (app/a/[id]/assets); a URL with no copy has nothing to refresh and is left
 * out of the report rather than named as a failure.
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
    const named = collectExternalAssetUrls(row.source ?? '').all;
    const held = await lookupWebAssets(named);
    urls = named.filter((u) => held.has(u));
    // The bytes belong to whoever the DOCUMENT belongs to, exactly as they did
    // when the view-time door imported them — an editor refreshing does not take them over.
    const owner = writerFor(row);
    by = { tokenId: owner.tokenId, userId: owner.userId };
  } else {
    urls = [url!];
  }
  return json(await refreshWebAssets(urls, by));
}

function preflightReply(prepared:PreparedContent):Response {
  return json({valid:true,dry_run:true,markup:prepared.content.source,format:prepared.content.format,
    planned:{objects:prepared.objects.length},
    commit_checks:['authorization','quota','references','observed_state'],...sourceRepairsEcho(prepared.content.repairs)});
}


/**
 * After a dataset/viz refresh: re-run reference validation for every dependent
 * against the NEW content. Warnings, never blocks: a data refresh
 * can't be stopped by a stale chart.
 */
async function refreshWarningsFor(actor: TokenActor, updated: ArtifactRow): Promise<Array<{ id: string; title: string | null; details: string[] }>> {
  if (updated.format !== 'dataset' && updated.format !== 'viz') return [];
  const dependents = await findDependentsFor(actor, updated.id);
  if (dependents.length === 0) return [];
  const base = refLoaderForActor(actor);
  const load: ServerRefLoader = async (id) => (id === updated.id ? rowToResolvedRef(updated) : base(id));
  const warnings: Array<{ id: string; title: string | null; details: string[] }> = [];
  for (const dep of dependents) {
    if (!dep.source) continue;
    // The SAME checks the publish door runs (refs, SQL dry run, chart bindings
    // against query columns) — so "which dependents broke" is answered by the
    // rule that admitted them.
    const checked = await checkDocumentData(dep.source, load);
    if (!checked.ok) warnings.push({ id: dep.id, title: dep.title, details: checked.details });
  }
  return warnings;
}
