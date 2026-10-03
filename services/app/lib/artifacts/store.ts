import { LIVE_ARTIFACT_SQL, SHARE_PREDICATE, editorScope, ownerPredicate, ownerScope, type ArtifactRow, type DatasetAccess, type Scope, type TokenActor, type Visibility, writerFor } from './access';
import { compiledForRow, isEmptyCompiled, rowToResolvedRef } from './dataflow';
import type { DocumentUpdate, GraphPatch } from '@artifactbin/contracts';
import { commitDocumentUpdate } from '../story/graph/document-update-write';
import { queueMermaidHarvest } from '../mermaid-images/store';
import type { ProseOperation } from '../story/graph/index';
import type { DocumentOperation } from '@artifactbin/contracts';
import { createDocumentGraph } from '../story/graph/document-graph';
import { prepareClientDocumentPublication } from '../story/graph/document-update-client';
import { prepareDocumentAuthoringContext } from '../story/document/document-authoring-context';
import { artifactQuery, loadArtifactDocument, sourceStorage } from './document';
import { seedOwnerJoin } from '../accounts/relation-state';
import { documentMentions } from '../annotations/saved-mentions';
import { grantsOf, grantsPermitRead } from '../datasets/policy/grants';
import { claimArtifactId } from './identities';
import { parseDatasetDefinition, serializeDatasetDefinition } from '@/lib/datasets/definition';
import { validateUserContent, retainUserScope, resolveUserColumnScope } from '@/lib/datasets/user-fields';
import { userKindOf } from '@/lib/accounts/user-kinds';
import { sourceChanges } from '../story/document/source-changes';
import { reserveCreation, completeCreation, type CreationOperation } from './creation-ledger';
import { artifactState } from './state';
import { channelFor } from '../story/realtime/live';
import { annotationEffects, type AnnotationRecord, type AnnotationReceipt } from '../story/annotations/annotation-edits';
import type { AnnotationOperation } from '../editor-v2/annotation-map';
import { catalogOf } from '@/lib/datasets/catalog';
import { claimPendingDatasetSecret, resolveDatasetConnection } from '@/lib/datasets/secrets';
import { DatasetError } from '@/lib/datasets/errors';
import { trackEvent } from '../platform/analytics';
import { ALLOW_PUBLIC_VISIBILITY, ARTIFACT_QUOTA_PER_TOKEN } from '../platform/config';
import { assetByteQuotaExceeded } from '../serving/asset-quota';
import { getDb, type Db, type Queryable } from '../platform/db';
import type { DatasetAccessPolicy as DatasetPolicy } from '@artifactbin/contracts';
import { defaultDatasetGrants } from '@artifactbin/utils';
import { validateDatasetPolicyForRow } from '../datasets/policy/validation';
import { actorSubject, emit } from '../platform/events';
import { generateFileId } from '../platform/ids';
import { type ArtifactFormat } from '../story/document/input';
import { resolveWebFont, UnknownFontError } from '../webfonts/index';
import { json } from '../http/http';
import { loadDatasetRows } from '../story/datasets/dataset-store';
import { newEditId } from '../story/document/splice';
import type { StringEdit } from '../story/document/index';
import { nodeIndex, stampNodeIds } from '../story/document/node-ids';
import { COMPILED_DATAFLOW, finalizeArtifactMetadata, storedCompiledDataflow } from '../story/data/parsed-artifact-metadata';
import { warmPreparedPage } from '../story/prepared/prepared-page.server';
import { DATA_SYNTAX_META, hasCurrentDataSyntax, previousEngineRestore } from '../story/data/data-syntax';
import { inCurrentSyntax } from '../migrate/sqlite/stored';
import { convertArtifactNow } from './sqlite-syntax-migration';
import { ancestorsForMove, notifyParent, parentOf } from '@/lib/workspace/folders';
import type { RefLoader, ResolvedRef } from '@/lib/story/data';
import type { DatasetColumn } from '@/lib/story/data/data-tiers';
import { type ShareEntry, type ShareRole } from './share-roles';

// `link_role` is deliberately absent: SUMMARY_COLS does not select it, and a
// listing is an index rather than a bulk read. The general-access role is read
// through the sharing surface, where it is edited.
export type ArtifactSummary = Omit<ArtifactRow, 'source' | 'token_id' | 'user_id' | 'actor_user_id' | 'actor_token_id' | 'link_role' | 'forked_from' | 'deleted_at'>;

/** The stored representation of one artifact state (built by parseContentInput). */
export interface ArtifactInput {
  title?: string | null;
  description?: string | null;
  format: ArtifactFormat;
  source: string | null;
  meta: Record<string, unknown>;
  /** Absent on replace = keep the current value. */
  visibility?: Visibility;
  /** Absent on replace = keep the current value. Datasets only (routes refuse it elsewhere). */
  access?: DatasetAccess;
  /**
   * PLACEMENT, already resolved. The WIRE speaks `parent_id` (an agent holds a
   * folder's id and nothing else); the array is what the parent's own row
   * answers, through lib/folders `resolveParent` — which reads a row, and so
   * runs only AFTER the ownership scope has resolved the row being written.
   * Absent on replace = leave it where it is.
   */
  ancestor_ids?: string[];
  link_role?: ShareRole;
}

const SUMMARY_COLS = 'id, title, description, format, meta, version, visibility, access, ancestor_ids, created_at, updated_at';

// ── Per-token quota ──────────────────────────────────────────────────────────

let quotaOverride: number | null = null;
/** Tests inject the cap here instead of mutating process.env (config is read once at import). */
export function setArtifactQuotaForTests(cap: number | null): void {
  quotaOverride = cap;
}

/**
 * True when the token is at its artifact cap (0 ⇒ unlimited). Creation-time
 * only — edits never block.
 *
 * `creating` is how many rows the caller is about to make, which is 1 for every
 * ordinary create and more for the ONE call that makes several at once: a fork
 * of an app creates the page PLUS a copy of each dataset it writes, and a cap
 * that only saw the page would let the quota be walked past a dataset at a time.
 */
export async function artifactQuotaExceeded(tokenId: string, creating = 1): Promise<boolean> {
  const cap = quotaOverride ?? ARTIFACT_QUOTA_PER_TOKEN;
  if (!cap) return false;
  const db = await getDb();
  /*
   * EVERY ROW, deleted or not — the one deliberate reader past the trash gate
   * outside lib/trash, and the only quota rule that survives having no purge.
   * Nothing is ever erased, so a deleted document still occupies its row, its
   * versions, its edit log and its bytes forever; counting live rows alone
   * would make delete-and-recreate an unlimited cap with an extra call in it.
   * The trade is stated in the docs rather than hidden: deleting does not free
   * you to publish another one.
   */
  const r = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM artifacts WHERE token_id = $1', [tokenId]);
  return (r.rows[0]?.n ?? 0) + creating > cap;
}

/** First owning report attachment freezes unresolved memberOf scopes atomically. */
async function bindCurrentUserScopes(tx:Queryable,document:ArtifactRow):Promise<void> {
 if(document.format!=='markup')return;
 const refs=(document.meta.refs as Array<{id:string}>|undefined)??[];
 for(const ref of [...refs].sort((a,b)=>a.id.localeCompare(b.id))) {
  const dataset=(await artifactQuery<ArtifactRow>(tx,"SELECT * FROM artifacts WHERE id=$1 AND format='dataset' AND deleted_at IS NULL FOR UPDATE",[ref.id])).rows[0];
  const catalog=dataset?catalogOf(dataset):null;
  if(!dataset||!catalog||!catalog.tables.some(t=>t.columns.some(c=>c.constraints?.memberOf?.includes('current'))))continue;
  if(document.user_id ? dataset.user_id!==document.user_id : dataset.token_id!==document.token_id)throw new DatasetError('Only the dataset owner can bind memberOf current to a report',403);
  const columns=(cs:DatasetColumn[])=>resolveUserColumnScope(cs,document.id);
  const bound={...catalog,tables:catalog.tables.map(t=>({...t,columns:columns(t.columns)}))};
  let source=dataset.source;
  if(source?.trimStart().startsWith('<Dataset')) {
   const definition=parseDatasetDefinition(source);
   source=serializeDatasetDefinition({...definition,tables:definition.tables.map(t=>({...t,columns:t.columns?.map(c=>typeof c==='string'?c:columns([c])[0]!)}))});
  }
  await archiveVersion(tx,dataset);
  const meta={...dataset.meta,userScopeDocument:document.id,catalog:bound,columns:columns((dataset.meta.columns??[]) as DatasetColumn[])};
  const updated=(await artifactQuery<ArtifactRow>(tx,'UPDATE artifacts SET meta=$2,source=$3,version=version+1,edit_id=$4,updated_at=now() WHERE id=$1 RETURNING *',[dataset.id,JSON.stringify(meta),source,newEditId()])).rows[0];
  await logWholeDocumentWrite(tx,dataset,updated);
 }
}

export async function createArtifact(
  tokenId: string,
  userId: string | null,
  input: ArtifactInput,
  /**
   * What only CREATION may set, deliberately NOT fields on ArtifactInput: that
   * shape is shared with the replace path, and neither of these is a thing a
   * content write may change.
   *   forkedFrom — provenance; written once and never updated.
   *   linkRole   — GENERAL ACCESS, the role the LINK grants. Every other
   *                creation leaves it NULL (which `linkRoleOf` reads as
   *                'viewer') and the sharing surface owns it afterwards; a
   *                FORK carries the source's, exactly as it carries visibility
   *                and access — the same axis, and carrying the tier while
   *                resetting the role would be incoherent.
   *   datasetPolicy— the stored write policy, copied WITH the dataset it
   *                governs (a fork of an app copies both). Every other route to
   *                a policy is lib/datasets/policy `setDatasetPolicy`, which
   *                needs the row to exist first; a copy has no "first".
   *   tx         — run inside the caller's OPEN transaction instead of opening
   *                one. The caller then owns the post-commit effects
   *                (`afterCreated`): reaching trackEvent/notifyParent from
   *                inside a transaction would enqueue a query behind the
   *                transaction that holds PGLite's one connection.
   */
  atCreation: { reservedId?:string; forkedFrom?: string; linkRole?: ShareRole | null; operation?: CreationOperation | null; shares?:ShareEntry[]; datasetPolicy?: { policy: unknown; revision: number }; tx?: Queryable } = {},
): Promise<ArtifactRow> {
  if (input.format === 'markup' && input.source) {
    input = { ...input, source: stampNodeIds(input.source, { retireLegacyAliases: true }).source };
  }
  // A document is born in the current data syntax (lib/story/data/data-syntax).
  input = { ...input, meta: { ...finalizeArtifactMetadata(input.format, input.source, input.meta), ...(input.format === 'markup' ? DATA_SYNTAX_META : {}) } };
  let sourceIds: string[] = [];
  if(input.format==='markup'&&input.source) {
    sourceIds=[...nodeIndex(input.source).keys()];
  }
  // INSIDE THE CALLER'S TRANSACTION: no retry (a PK violation has already
  // poisoned it — the ids are reserved beforehand instead) and no post-commit
  // effects, which are the caller's to run once its own transaction commits.
  if (atCreation.tx) return insertArtifact(atCreation.tx, atCreation.reservedId ?? generateFileId(), tokenId, userId, input, sourceIds, atCreation);
  const db = await getDb();
  // Birthday collisions at 62^6 are routine once the table is large, so the
  // PK-violation retry is a working path, not a theoretical one.
  const ID_MINT_ATTEMPTS = 5;
  for (let attempt = 0; ; attempt++) {
    const id = atCreation.reservedId ?? generateFileId();
    try {
      const row = await db.transaction((tx) => insertArtifact(tx, id, tokenId, userId, input, sourceIds, atCreation));
      await afterCreated(row, userId);
      return row;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!atCreation.reservedId && code === '23505' && attempt < ID_MINT_ATTEMPTS) continue;
      throw error;
    }
  }
}

/** What a creation says to the rest of the system, AFTER its transaction committed. */
export async function afterCreated(row: ArtifactRow, userId: string | null): Promise<void> {
  void trackEvent('create', row.id, { userId, parentId: parentOf(row) });
  // The first reader of a new document finds it prepared (lib/story/prepared/prepared-page.server).
  if (row.format === 'markup') warmPreparedPage(row.id);
  // Its diagrams are drawn to stored SVG in the background; nothing waits on it.
  void queueMermaidHarvest(row);
  // A child arriving wakes the folder it landed in, so an open listing
  // re-runs its own query with no reload.
  await notifyParent(parentOf(row));
}

/** The creation itself: every row one artifact is born with, and nothing outside the transaction. */
async function insertArtifact(
  tx: Queryable,
  id: string,
  tokenId: string,
  userId: string | null,
  input: ArtifactInput,
  sourceIds: string[],
  atCreation: Parameters<typeof createArtifact>[3] = {},
): Promise<ArtifactRow> {
  if (atCreation.operation) await reserveCreation(tx,atCreation.operation);
  await claimArtifactId(tx,id,{tokenId,userId},!!atCreation.reservedId);
  // A FORK carries its source's rows verbatim — a snapshot the forker may read,
  // not rows the forker wrote — so a user column's "must be the logged-in user"
  // rule is not re-judged under the forker's id: that would make every app
  // whose rows name its members unforkable by anyone but the one person named.
  if (!atCreation.forkedFrom) await validateUserContent(tx,input,userId,key=>loadDatasetRows({meta:{objectKey:key}}));
  const catalog=catalogOf(input);
  if(catalog?.kind==='postgres'&&catalog.connection)await claimPendingDatasetSecret(catalog.connection,{tokenId,userId},id,tx);
  const ownerKind = await userKindOf(userId, tx);
  const guestDefault = input.visibility === undefined && ownerKind === 'guest';
  /*
   * THE SANDBOX CEILING. A test user's work never lists anywhere and is never
   * `public`: it exists to be looked at by the account that minted it and by
   * the other throwaway people in there, and it is ERASED with its owner. A
   * `public` ask is stored as `unlisted` rather than refused — the copy is
   * still reachable by link, which is what the asker wanted it for — and the
   * create reply carries the visibility it really got.
   */
  const visibility = ownerKind === 'testuser'
    ? (input.visibility === 'public' || input.visibility === undefined ? 'unlisted' : input.visibility)
    : input.visibility ??
      (!userId || guestDefault ? (ALLOW_PUBLIC_VISIBILITY ? 'public' : 'unlisted')
        : input.format === 'image' || input.format === 'dataset' || input.format === 'pdf' || input.format === 'file' ? 'unlisted' : 'private');
  const datasetPolicy = atCreation.datasetPolicy?.policy ??
    (!atCreation.forkedFrom && input.access===undefined && input.format==='dataset' && catalog?.kind!=='postgres' ? defaultDatasetGrants() : null);
  const created = await artifactQuery<ArtifactRow>(tx,
  // The genesis edit row makes the creation's edit_id resolvable like any
  // other: an agent that creates and then edits against that id is on an
  // ordinary (if empty) base, not an unknown one. Data-modifying CTEs
  // always execute, so the log row lands even though nothing reads it.
  `WITH created AS (
     INSERT INTO artifacts (id, token_id, user_id, title, description, format, source, meta, visibility, link_role, ancestor_ids, edit_id, access, forked_from, actor_user_id, actor_token_id, dataset_policy, policy_revision, document)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $18::jsonb IS NULL THEN $7::text ELSE NULL END, $8, $9, $10, $11, $12, $13, $14, $3, $2, $16::jsonb, $17::int, $18::jsonb) RETURNING *
   ), genesis AS (
     INSERT INTO artifact_edits (artifact_id, edit_id, splice_start, removed, inserted, span_start, span_end, actor_user_id, actor_token_id, document_state)
     SELECT id, edit_id, 0, '', COALESCE($7::text, ''), 0, 0, $3, $2, jsonb_build_object('epoch',COALESCE(document->>'epoch',document#>>'{prose,epoch}'),'version',version) FROM created
   ), reserved AS (
     INSERT INTO artifact_source_ids (artifact_id, source_id, provenance, first_version)
     SELECT $1, value #>> '{}', 'authored', 1 FROM jsonb_array_elements($15::jsonb)
   ), policy_audit AS (
     INSERT INTO dataset_policy_audit (dataset_id, revision, policy, actor_user_id, actor_token_id)
     SELECT $1, $17::int, $16::jsonb, $3, $2 WHERE $16::jsonb IS NOT NULL
   )
   SELECT * FROM created`,
  [
    id,
    tokenId,
    userId,
    input.title ?? null,
    input.description ?? null,
    input.format,
    input.source,
    JSON.stringify(input.meta),
    // Guest identities retain anonymous public defaults. Registered
    // accounts create private documents, except assets, born
    // unlisted: a public document reaches them at read time, and a
    // born-private ref bakes a 404 into every shared document that uses
    // it. Routes validate an explicit ask upstream. Decided above, because a
    // test user's ceiling is part of the same one decision.
    visibility,
    // NULL reads as 'viewer' (linkRoleOf), which is what every ordinary
    // creation grants whoever holds the link.
    atCreation.linkRole ?? null,
    input.ancestor_ids ?? [],
    newEditId(),
    // Read-only unless the caller asked otherwise: a dataset that could
    // be written by default would make every existing document's data
    // mutable without anyone choosing it.
    input.access ?? 'read',
    atCreation.forkedFrom ?? null,
    JSON.stringify(sourceIds),
    // A DATASET carried whole, policy included. NULL for every other
    // creation, which is also what makes the audit CTE above a no-op.
    datasetPolicy ? JSON.stringify(datasetPolicy) : null,
    atCreation.datasetPolicy?.revision ?? 0,
    sourceStorage(input.format,input.source,!atCreation.forkedFrom).document,
  ],
  );
  Object.assign(created.rows[0],await writeShares(tx,id,atCreation.shares??[]));
  await bindCurrentUserScopes(tx,created.rows[0]);
  if(input.format==='markup'&&userId)await seedOwnerJoin(tx,id,userId);
  if(!atCreation.forkedFrom)await documentMentions(tx,created.rows[0],{userId,tokenId});
  if (atCreation.operation) await completeCreation(tx,atCreation.operation,created.rows[0]);
  return created.rows[0];
}

export async function getArtifact(tokenId: string, id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  return loadArtifactDocument<ArtifactRow>(db,`SELECT * FROM artifacts WHERE id = $1 AND token_id = $2 AND ${LIVE_ARTIFACT_SQL}`, [id, tokenId]);
}

export async function getArtifactByUser(userId: string, id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  return loadArtifactDocument<ArtifactRow>(db,`SELECT * FROM artifacts WHERE id = $1 AND user_id = $2 AND ${LIVE_ARTIFACT_SQL}`, [id, userId]);
}

async function listArtifactsScoped(scope: Scope): Promise<ArtifactSummary[]> {
  const db = await getDb();
  const r = await db.query<ArtifactSummary>(
    `SELECT ${SUMMARY_COLS} FROM artifacts WHERE ${scope.where('$1')} ORDER BY updated_at DESC LIMIT 100`,
    [scope.val],
  );
  return r.rows;
}

/**
 * Unscoped read for the public serving paths (/a/<id> and its sub-routes).
 * The id is an ADDRESS, not a credential — whether this viewer may see the
 * row is the caller's decision (the visibility ACL), made before serving.
 */
export async function getArtifactById(id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  return loadArtifactDocument<ArtifactRow>(db,`SELECT * FROM artifacts WHERE id = $1 AND ${LIVE_ARTIFACT_SQL}`, [id]);
}

interface VersionSummary {
  version: number;
  title: string | null;
  description: string | null;
  format: string;
  /** The handle of the account that produced this state; null for a token or an unnamed account. */
  by: string | null;
  created_at: string;
}

/** Archive the head as it stands — its author rides along, so history can say who. */
async function archiveVersion(tx: Queryable, current: ArtifactRow): Promise<void> {
  await tx.query(
    `INSERT INTO artifact_versions (artifact_id, version, title, description, format, source, meta, actor_user_id, actor_token_id, document)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $10::jsonb IS NULL THEN $6::text ELSE NULL END, $7, $8, $9, $10::jsonb)`,
    [current.id, current.version, current.title, current.description, current.format, current.source, JSON.stringify(current.meta), current.actor_user_id, current.actor_token_id,sourceStorage(current.format,current.source).document],
  );
  await tx.query('UPDATE artifacts SET document_archived_at=now() WHERE id=$1',[current.id]);
}

/** The two actor columns a write stamps, in the order every statement binds them. */
const actorStamp = (actor: TokenActor): [string | null, string | null] => [actor.userId, actor.tokenId || null];

const SHARES_PROJECTION="COALESCE((SELECT jsonb_agg(jsonb_build_object('email',s.email,'role',s.role) ORDER BY s.email) FROM artifact_shares s WHERE s.artifact_id=artifacts.id),'[]'::jsonb) AS shares";
export async function writeShares(tx:Queryable,id:string,shares:ShareEntry[]):Promise<{shares:ShareEntry[];sharing_revision:number}>{
 const normalized=[...new Map(shares.map(entry=>[entry.email.trim().toLowerCase(),entry.role])).entries()].sort(([a],[b])=>a.localeCompare(b)).map(([email,role])=>({email,role}));
 const current=(await tx.query<ShareEntry>('SELECT email,role FROM artifact_shares WHERE artifact_id=$1 ORDER BY email',[id])).rows;
 if(JSON.stringify(current)!==JSON.stringify(normalized)){
  // Retained invitations keep their resolved account identity, even after an
  // email change. Recreating them would transfer access to a reused address.
  await tx.query('DELETE FROM artifact_shares WHERE artifact_id=$1 AND NOT (email=ANY($2::text[]))',[id,normalized.map(entry=>entry.email)]);
  for(const entry of normalized)await tx.query('INSERT INTO artifact_shares (artifact_id,email,role) VALUES ($1,$2,$3) ON CONFLICT (artifact_id,email) DO UPDATE SET role=EXCLUDED.role',[id,entry.email,entry.role]);
  await tx.query('UPDATE artifacts SET sharing_revision=sharing_revision+1 WHERE id=$1',[id]);
 }
 const row=(await tx.query<{sharing_revision:number}>('SELECT sharing_revision FROM artifacts WHERE id=$1',[id])).rows[0];
 return {shares:normalized,sharing_revision:row.sharing_revision};
}
async function getArtifactScoped(scope: Scope, id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  return loadArtifactDocument<ArtifactRow>(db,`SELECT artifacts.*, ${SHARES_PROJECTION} FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val]);
}

/**
 * Whole-document writes (PUT, revert) join the edit protocol rather than
 * sitting outside it: they mint a fresh `edit_id`, log one splice covering the
 * entire old document for restoration/migration. Ordinary markup replacement
 * records its actual node-scoped changes so unrelated stale edits can rebase.
 * Both paths wake live readers.
 * Callers must already hold the row inside `tx`.
 */
async function logWholeDocumentWrite(tx: Queryable, before: ArtifactRow, after: ArtifactRow, nodeScoped=false): Promise<void> {
  const oldText = before.source ?? '';
  const newText = after.source ?? '';
  const changes=nodeScoped&&before.format==='markup'&&after.format==='markup'?sourceChanges(oldText,newText):null;
  if(changes&&!changes.length)changes.push({splice:{start:0,removed:'',inserted:''},span:{start:0,end:0}});
  await tx.query(
    `INSERT INTO artifact_edits (artifact_id, edit_id, splice_start, removed, inserted, span_start, span_end, actor_user_id, actor_token_id, changes)
     VALUES ($1, $2, 0, $3, $4, 0, $5, $6, $7, $8::jsonb)`,
    [after.id, after.edit_id, oldText, newText, oldText.length, after.actor_user_id, after.actor_token_id, changes?JSON.stringify(changes):null],
  );
  // Lowercased to match channelFor (lib/story/realtime/live.ts) — see the note there.
  await tx.query('SELECT pg_notify($1, $2)', [`artifact_${after.id.toLowerCase()}`, after.edit_id]);
}

/**
 * Commit an already-published markup source while the caller holds the
 * artifact row lock. Migration and ordinary whole-document paths share this
 * single reservation/history boundary; events are emitted by the caller only
 * after its surrounding transaction commits.
 */
export interface PreparedMarkupWrite {
 source:string;meta:Record<string,unknown>;ids:string[];aliases:Array<{legacyKey:string;nodeId:string;path:string}>;
 update:DocumentUpdate;
}
export async function commitNormalizedMarkup(
 tx:Queryable,actor:TokenActor|null,current:ArtifactRow,
 normalized:PreparedMarkupWrite & {title?:string|null;description?:string|null;format?:ArtifactFormat},
):Promise<ArtifactRow>{
 const scope=actor?editorScope(actor):{val:current.id,where:(param:string)=>`id=${param}`};
 const committed=await commitDocumentUpdate(tx,actor,scope,current.id,{...normalized.update,aliases:normalized.aliases});
 if(!committed?.applied)throw new Error('artifact changed after identity preparation');
 return committed.row;
}

/** Administrative authoring uses the same client compiler and commit contract. */
export async function publishMarkupForArtifact(current:ArtifactRow,source:string,metaOverride:Record<string,unknown>=current.meta):Promise<Response|PreparedMarkupWrite>{
 const db=await getDb();
 const reserved=await db.query<{source_id:string}>('SELECT source_id FROM artifact_source_ids WHERE artifact_id=$1',[current.id]);
 const aliases=await db.query<{legacy_key:string;source_id:string}>('SELECT legacy_key,source_id FROM artifact_node_aliases WHERE artifact_id=$1',[current.id]);
 const identity=stampNodeIds(source,{previousSource:current.source,reservedIds:reserved.rows.map(row=>row.source_id),legacyAliases:new Map(aliases.rows.map(row=>[row.legacy_key,row.source_id])),retireLegacyAliases:true});
 try{
  const document=current.document?.kind==='graph'?current.document:createDocumentGraph(current.source??'',current.version);
  const metadata={theme:(metaOverride.theme??null) as string|null,template:(metaOverride.template??null) as string|null,colorMode:(metaOverride.colorMode??null) as 'light'|'dark'|null};
  const update=await prepareClientDocumentPublication({...current,document},{source:identity.source,metadata,whole:true},async context=>{
   const response=await prepareDocumentAuthoringContext(writerFor(current),current.id,{source:context});
   if(!response.ok)throw response;
   return response.json();
  });
  return {source:identity.source,meta:metaOverride,ids:identity.ids,aliases:identity.aliases,update};
 }catch(error){return error instanceof Response?error:json({error:'invalid_jsx',details:[String(error)]},400);}
}

async function listVersionsScoped(scope: Scope, id: string): Promise<VersionSummary[] | null> {
  const db = await getDb();
  const owned = await db.query(`SELECT 1 FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val]);
  if (owned.rows.length === 0) return null;
  const r = await db.query<VersionSummary>(
    `SELECT v.version, v.title, v.description, v.format, u.username AS by, v.created_at
     FROM artifact_versions v LEFT JOIN users u ON u.id = v.actor_user_id
     WHERE v.artifact_id = $1 ORDER BY v.version DESC`,
    [id],
  );
  return r.rows;
}

interface VersionContent extends VersionSummary {
  source: string | null;
  meta: Record<string, unknown>;
  /** Written for the previous engine, and the converter cannot carry it over without a person (lib/migrate/sqlite/stored). */
  previousEngine?: true;
}

/** One archived version WITH content (the editor's version viewer). */
async function getVersionScoped(scope: Scope, id: string, version: number): Promise<VersionContent | null> {
  const db = await getDb();
  const owner = (await db.query<{ user_id: string | null; token_id: string }>(`SELECT user_id, token_id FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val])).rows[0];
  if (!owner) return null;
  const row = await loadArtifactDocument<VersionContent>(db,
    `SELECT v.artifact_id, v.document, v.version, v.title, v.description, v.format, v.source, v.meta, u.username AS by, v.created_at
     FROM artifact_versions v LEFT JOIN users u ON u.id = v.actor_user_id
     WHERE v.artifact_id = $1 AND v.version = $2`,
    [id, version],
  );
  if (row?.format !== 'markup') return row;
  // History stays as stored; it READS in the current data syntax, so whatever
  // restores it (the browser and CLI restores submit these bytes whole) lands
  // the converted document (lib/migrate/sqlite/stored).
  const { id: _id, user_id: _user, token_id: _token, ...served } = await inCurrentSyntax({ ...row, id, user_id: owner.user_id, token_id: owner.token_id });
  return served;
}

/** One archived version on the wire: `markup` carries the source; one written for the previous engine that needs a person says it cannot be restored as it stands. */
export function versionToWire(row: VersionContent): Record<string, unknown> {
  const { source, previousEngine, ...rest } = row;
  return { ...rest, markup: source, ...(previousEngine ? { previous_engine: previousEngineRestore(row.version) } : {}) };
}

/**
 * The head an EDITOR reads to edit (the CLI pull, the browser editor's load):
 * a document the migration has not reached is converted for real first
 * (lib/sqlite-syntax-migration convertArtifactNow), so its markup, graph,
 * edit id and state all describe the converted document the next patch is
 * prepared against, and an author never edits the previous syntax. One that
 * needs a person is read as it stands.
 */
export async function getEditableArtifactFor(actor: TokenActor, id: string): Promise<ArtifactRow | null> {
  const row = await getArtifactFor(actor, id);
  if (row?.format !== 'markup' || hasCurrentDataSyntax(row.meta)) return row;
  const outcome = await convertArtifactNow(await getDb(), id);
  return outcome?.outcome === 'converted' || outcome?.outcome === 'unchanged' ? getArtifactFor(actor, id) : row;
}

/**
 * Asked for a version of an artifact that exists and is theirs, but which was
 * never archived. Save-less editing bumps `version` on every accepted edit
 * while snapshots COALESCE, so most version numbers are checkpoints that were
 * skipped — and answering the uniform 404 there would claim the artifact does
 * not exist. Ownership is already proved by this point, so naming the real
 * reason leaks nothing. `GET /versions` lists what can actually be restored.
 */
interface VersionNotArchived {
  notArchived: true;
  refusal?: Response;
  conflictVersion?: number;
}
export function isVersionNotArchived(r: ArtifactRow | null | VersionNotArchived): r is VersionNotArchived {
  return r !== null && 'notArchived' in r;
}

/**
 * The refusal a dataset's WRITE POLICY answers — 409, by name, never the
 * uniform 404. One spelling for every door that has to say it, because a
 * caller learning "policy_locked" once should not meet a second code for the
 * same fact on the next door.
 */
const policyLocked = (detail: string): Response => json({error:'policy_locked',detail},409);

/**
 * Revert to an archived version — as a NEW version (the current state is
 * archived first), so a revert is itself revertible and the URL never moves.
 * Null when the artifact or the requested version doesn't exist.
 */
async function revertScoped(actor: TokenActor, id: string, version: number, opts: ReplaceOpts = {}): Promise<ArtifactRow | null | VersionNotArchived> {
  const db = await getDb();
  const scope = editorScope(actor);
  const initial = (await artifactQuery<ArtifactRow>(db,`SELECT * FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`, [id,scope.val])).rows[0];
  if (!initial) return null;
  // A governed dataset is not revertible: restoring an archived table would
  // drop the rows viewers have written under the policy since. The GUARD is
  // unchanged — what changed is that it now says so instead of answering the
  // uniform 404 for a dataset the caller is looking straight at.
  if (initial.dataset_policy) return {notArchived:true,refusal:policyLocked('a dataset with a write policy cannot be reverted — republish the rows you want as the owner')};
  const condition = (row: ArtifactRow): Response | null => {
    if (opts.expectedVersion !== undefined && row.version !== opts.expectedVersion) return json({error:'version_conflict',currentVersion:row.version,currentState:artifactState(row)},409);
    if (opts.expectedState !== undefined && artifactState(row) !== opts.expectedState) return json({error:'state_conflict',currentVersion:row.version,currentState:artifactState(row)},409);
    return null;
  };
  const refusal = condition(initial); if (refusal) return {notArchived:true,refusal};
  let target = (await artifactQuery<ArtifactRow>(db,'SELECT title,description,format,source,document,meta FROM artifact_versions WHERE artifact_id=$1 AND version=$2',[id,version])).rows[0];
  if (!target) return {notArchived:true};
  if(target.format==='markup')return {notArchived:true,refusal:json({error:'jsonb_operations_required',hint:'Read the archived version and submit a client-validated whole JSONB replacement.'},400)};

  // Event fires post-txn: an unawaited query from inside the callback would
  // deadlock PGLite's serialized op queue.
  const result: ArtifactRow | null | VersionNotArchived = await db.transaction(async (tx) => {
    const current = (
      await artifactQuery<ArtifactRow>(tx,`SELECT * FROM artifacts WHERE id = $1 AND ${scope.where('$2')} FOR UPDATE`, [id, scope.val])
    ).rows[0];
    if (!current) return null;
    if (current.dataset_policy) return {notArchived:true,refusal:policyLocked('a dataset with a write policy cannot be reverted — republish the rows you want as the owner')};
    const refusal = condition(current); if (refusal) return {notArchived:true,refusal};
    if(artifactState(current)!==artifactState(initial)) return {notArchived:true,conflictVersion:current.version};

    if(target.format==='dataset'&&!catalogOf(target))return {notArchived:true,refusal:json({error:'dataset_error',details:['Historical dataset has no catalog or stored object key']},400)};
    target=retainUserScope(target,current);
    try {await validateUserContent(tx,target,actor.userId,key=>loadDatasetRows({meta:{objectKey:key}}));}catch(error){if(error instanceof DatasetError)return {notArchived:true,refusal:json({error:"dataset_error",details:[error.message]},error.status)};throw error;}
    const targetCatalog=catalogOf(target);
    if(targetCatalog?.kind==='postgres'&&targetCatalog.connection){
      try{await resolveDatasetConnection(targetCatalog.connection,undefined,current.id,tx);}
      catch(error){
        if(error instanceof DatasetError)return {notArchived:true,refusal:json({error:'dataset_error',details:[error.message]},error.status)};
        throw error;
      }
    }

    await archiveVersion(tx, current);
    const updated = await artifactQuery<ArtifactRow>(tx,
      `UPDATE artifacts
       SET title = $3, description = $4, format = $5, source = CASE WHEN $11::jsonb IS NULL THEN $6::text ELSE NULL END, document=$11::jsonb, meta = $7, version = version + 1,
           edit_id = $8, actor_user_id = $9, actor_token_id = $10, updated_at = now()
       WHERE id = $1 AND ${scope.where('$2')} RETURNING *`,
      [id, scope.val, target.title, target.description, target.format, target.source, JSON.stringify(target.meta), newEditId(), ...actorStamp(actor),sourceStorage(target.format,target.source).document],
    );
    await logWholeDocumentWrite(tx, current, updated.rows[0]);
    if (updated.rows[0].format === 'markup' && updated.rows[0].source) {
      const ids = [...nodeIndex(updated.rows[0].source).keys()];
      await tx.query('UPDATE artifact_source_ids SET retired_version=NULL WHERE artifact_id=$1 AND source_id=ANY($2::text[])', [id, ids]);
      await tx.query('UPDATE artifact_source_ids SET retired_version=$2 WHERE artifact_id=$1 AND retired_version IS NULL AND NOT (source_id=ANY($3::text[]))', [id, updated.rows[0].version, ids]);
    }
    return updated.rows[0];
  });
  if (result && !isVersionNotArchived(result)) { void trackEvent('revert', result.id, { userId: result.user_id }); void queueMermaidHarvest(result); }
  return result;
}

/**
 * Optimistic-concurrency miss: the caller's `expectedVersion` no longer names
 * the head. Distinct from `null` (unknown/foreign) — routes answer 409, not
 * 404, and report the head version so the caller can read → merge → replay.
 */
interface VersionConflict {
  reason?: 'state_conflict' | 'doc_changed';
  currentState?: string;
  conflict: true;
  currentVersion: number;
}
export function isVersionConflict(r: ArtifactRow | null | VersionConflict | Response): r is VersionConflict {
  return r !== null && 'conflict' in r;
}

export interface ReplaceOpts {
  expectedPolicyRevision?:number;
  shares?:ShareEntry[];
  annotationOps?: AnnotationOperation[];
  expectedState?: string;
  /** When set, the replace applies only if it still names the head version. */
  expectedVersion?: number;
}

/**
 * Full replace: archive the current state to artifact_versions, then overwrite
 * with version+1 (the format may change). Omitted title/description keep their
 * current values. Null when no artifact matches (unknown/foreign).
 */
async function replaceScoped(
  actor: TokenActor,
  id: string,
  input: ArtifactInput,
  opts: ReplaceOpts = {},
): Promise<ArtifactRow | null | VersionConflict | Response> {
  const db = await getDb();
  const scope = editorScope(actor);
  if(input.format==='markup')return json({error:'jsonb_operations_required'},400);
  // Event and the parent wakeups fire post-txn — an unawaited query from
  // inside the callback would deadlock PGLite's serialized op queue.
  let moved: { from: string | null; to: string | null } | null = null;
  const result: ArtifactRow | null | VersionConflict | Response = await db.transaction(async (tx) => {
    const current = (
      await artifactQuery<ArtifactRow>(tx,`SELECT * FROM artifacts WHERE id = $1 AND ${scope.where('$2')} FOR UPDATE`, [id, scope.val])
    ).rows[0];
    if (!current) return null;
    /*
     * A GOVERNED DATASET IS THE OWNER'S TO REPUBLISH — AND NOBODY ELSE'S.
     *
     * This guard used to be `|| current.dataset_policy` on the line above, so
     * every re-push of a dataset carrying a write policy came back as the
     * uniform `not_found` — including the owner's, including one that only
     * added a column. `--policy viewers-write` is the documented way to make a
     * writable dataset, so the shorthand made the dataset permanently
     * unmaintainable and said nothing about why.
     *
     * Who: the ONE ownership rule, asked in SQL (ownerScope), never mirrored
     * in JS here. A named editor was invited to write the document, not to
     * replace the rows other people are writing under the owner's policy, and
     * they are told so BY NAME (`policy_locked`) rather than by a 404.
     */
    if (current.dataset_policy && !(await tx.query('SELECT 1 FROM artifacts WHERE id=$1 AND '+ownerScope(actor).where('$2'), [id, ownerScope(actor).val])).rows.length) {
      return policyLocked('this dataset carries a write policy; only its owner may replace its content');
    }
    if (opts.expectedState !== undefined && artifactState(current) !== opts.expectedState) return {conflict:true, reason:'state_conflict', currentVersion:current.version, currentState:artifactState(current)};
    if (opts.expectedVersion !== undefined && current.version !== opts.expectedVersion) {
      return { conflict: true, currentVersion: current.version };
    }
    input=retainUserScope(input,current);
    /*
     * The policy is re-validated against the REPLACEMENT's catalog, inside this
     * transaction, by the same function that validated it when it was set — so
     * a replacement that drops a table or a permission column is refused
     * (`policy_mismatch`, naming what is missing) instead of leaving a policy
     * pointing at columns that no longer exist. The policy row and its revision
     * are untouched by a replace: what was granted stays granted.
     */
    if (current.dataset_policy) {
      try { validateDatasetPolicyForRow({format:input.format,meta:input.meta}, current.dataset_policy); }
      catch (error) { return json({error:'policy_mismatch',detail:error instanceof Error?error.message:'The dataset policy does not fit this replacement.'},400); }
    }
    await validateUserContent(tx,input,actor.userId,key=>loadDatasetRows({meta:{objectKey:key}}));
    const replacementCatalog=catalogOf(input);
    if(replacementCatalog?.kind==='postgres'&&replacementCatalog.connection)await resolveDatasetConnection(replacementCatalog.connection,undefined,current.id,tx);

    const replacementIdentity = input.format === 'markup' && input.source
      ? stampNodeIds(input.source, {
          previousSource: current.source,
          reservedIds: (await tx.query<{source_id:string}>('SELECT source_id FROM artifact_source_ids WHERE artifact_id=$1',[id])).rows.map(row=>row.source_id),
          retireLegacyAliases: true,
        })
      : null;
    if(replacementIdentity) {
      const aliases=new Map<string,string>();
      for(const alias of replacementIdentity.aliases) {
        const prior=aliases.get(alias.legacyKey);
        if(prior && prior!==alias.nodeId) return {conflict:true,currentVersion:current.version};
        aliases.set(alias.legacyKey,alias.nodeId);
      }
    }

    const operations=opts.annotationOps??[];
    const annotationRows=operations.length?(await tx.query<AnnotationRecord>('SELECT id,anchor_key,range FROM annotations WHERE artifact_id=$1 AND root_id IS NULL AND deleted_at IS NULL FOR UPDATE',[id])).rows:[];
    const receipts=operations.length?(await tx.query<{annotation_changes:AnnotationReceipt[]}>(`SELECT annotation_changes FROM artifact_edits WHERE artifact_id=$1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(annotation_changes) receipt WHERE receipt->>'operationId'=ANY($2::text[]))`,[id,operations.map(op=>op.id)])).rows.flatMap(row=>row.annotation_changes??[]):[];
    if(operations.some(op=>op.kind==='undo'&&!receipts.some(receipt=>receipt.operationId===op.id&&receipt.direction==='map')))return {conflict:true,reason:'doc_changed',currentVersion:current.version};
    const effects=operations.length?annotationEffects(current.source??'',replacementIdentity?.source??input.source??'',operations,annotationRows,receipts):{updates:[],receipts:[]};
    await archiveVersion(tx, current);

    const updated = await artifactQuery<ArtifactRow>(tx,
      `UPDATE artifacts
       SET format = $3, source = CASE WHEN $15::jsonb IS NULL THEN $4::text ELSE NULL END, document=$15::jsonb, meta = $5, title = $6, description = $7,
           visibility = COALESCE($9, visibility), ancestor_ids = COALESCE($10::text[], ancestor_ids),
           access = COALESCE($11, access), link_role = COALESCE($14, link_role),
           version = version + 1, edit_id = $8, actor_user_id = $12, actor_token_id = $13, updated_at = now()
       WHERE id = $1 AND ${scope.where('$2')} RETURNING *`,
      [
        id,
        scope.val,
        input.format,
        replacementIdentity?.source ?? input.source,
        JSON.stringify(finalizeArtifactMetadata(input.format, replacementIdentity?.source ?? input.source, input.meta)),
        input.title !== undefined ? input.title : current.title,
        input.description !== undefined ? input.description : current.description,
        newEditId(),
        input.visibility ?? null,
        input.ancestor_ids ?? null,
        input.access ?? null,
        ...actorStamp(actor),
        input.link_role ?? null,
        sourceStorage(input.format,replacementIdentity?.source ?? input.source).document,
      ],
    );
    // A replace may also FILE the row. When the row is a folder, its whole
    // subtree follows in the same statement the move door uses — one prefix
    // swap, inside this transaction, so a half-moved tree cannot be observed.
    if (input.ancestor_ids && current.format === 'folder') {
      const swap = ancestorsForMove(current, input.ancestor_ids);
      await tx.query(swap.sql, swap.params);
    }
    if(opts.shares!==undefined)Object.assign(updated.rows[0],await writeShares(tx,id,opts.shares));
    else updated.rows[0].shares=(await tx.query<ShareEntry>('SELECT email,role FROM artifact_shares WHERE artifact_id=$1 ORDER BY email',[id])).rows;
    await bindCurrentUserScopes(tx,updated.rows[0]);
    await documentMentions(tx,updated.rows[0],actor,current.source??'');
    await logWholeDocumentWrite(tx, current, updated.rows[0],true);
    const movedAnnotations=new Set<string>();
    for(const change of effects.updates){
      const applied=await tx.query<{id:string}>('UPDATE annotations SET anchor_key=$3,range=$4 WHERE artifact_id=$1 AND id=$2 AND anchor_key=$5 AND range IS NOT DISTINCT FROM $6 RETURNING id',[id,change.annotationId,change.after.anchor,change.after.range,change.before.anchor,change.before.range]);
      for(const row of applied.rows)movedAnnotations.add(row.id);
    }
    if(effects.receipts.length)await tx.query('UPDATE artifact_edits SET annotation_changes=$3::jsonb WHERE artifact_id=$1 AND edit_id=$2',[id,updated.rows[0].edit_id,JSON.stringify(effects.receipts.filter(receipt=>!receipt.annotationId||movedAnnotations.has(receipt.annotationId)))]);
    if (updated.rows[0].format === 'markup' && updated.rows[0].source) {
      const ids = [...nodeIndex(updated.rows[0].source).keys()];
      await tx.query(`INSERT INTO artifact_source_ids (artifact_id,source_id,provenance,first_version)
        SELECT $1,value #>> '{}','authored',$2 FROM jsonb_array_elements($3::jsonb) ON CONFLICT DO NOTHING`, [id, updated.rows[0].version, JSON.stringify(ids)]);
      await tx.query(`UPDATE artifact_source_ids SET retired_version=$2 WHERE artifact_id=$1 AND retired_version IS NULL AND NOT (source_id = ANY($3::text[]))`, [id, updated.rows[0].version, ids]);
      await tx.query('UPDATE artifact_source_ids SET retired_version=NULL WHERE artifact_id=$1 AND source_id=ANY($2::text[])',[id,ids]);
      await tx.query(`WITH added AS (
        INSERT INTO artifact_node_aliases(artifact_id,legacy_key,source_id,source_path,created_version)
        SELECT $1,x->>'legacyKey',x->>'nodeId',x->>'path',$3 FROM jsonb_array_elements($2::jsonb) x
        ON CONFLICT DO NOTHING RETURNING legacy_key,source_id)
        UPDATE annotations a SET anchor_key=x.source_id FROM added x
        WHERE a.artifact_id=$1 AND a.anchor_key=x.legacy_key`,
        [id,JSON.stringify(replacementIdentity?.aliases ?? []),updated.rows[0].version]);
    }
    moved = { from: parentOf(current), to: parentOf(updated.rows[0]) };
    return updated.rows[0];
  });
  const written = result && !isVersionConflict(result) && !(result instanceof Response) ? result : null;
  if (written) { void trackEvent('update', written.id, { userId: written.user_id }); void queueMermaidHarvest(written); }
  // BOTH ends of a move wake: the folder the row left and the one it joined.
  if (moved) await wakeParents(moved);
  if (written) sayMoved(actor, written.id, moved);
  return result;
}

/**
 * The two channels a placement change wakes — the folder the row LEFT and the
 * one it JOINED — so an open listing at either end re-runs its own query.
 * Deduped, because a rename or a plain content write moves nothing and would
 * otherwise ping the same folder twice.
 */
async function wakeParents({ from, to }: { from: string | null; to: string | null }): Promise<void> {
  for (const id of new Set([from, to])) await notifyParent(id);
}

/**
 * The MOVE, said once, by whichever of the two placement doors ran it — the
 * PATCH that only files a row, and the replace that files it while writing it.
 *
 * Guarded on the ends being DIFFERENT, because a plain content write computes
 * the same pair and would otherwise say a move on every save. Fire-and-forget
 * and outside the transaction, like every other emit here (lib/events).
 */
function sayMoved(actor: TokenActor, id: string, moved: { from: string | null; to: string | null } | null): void {
  if (!moved || moved.from === moved.to) return;
  void emit(actorSubject(actor), 'moved', { kind: 'artifact', id }, { from_parent_id: moved.from, to_parent_id: moved.to });
}

// ── The concurrent-edit protocol ─────────────────────────────────────────────

/**
 * One edit against a claimed base version. Agents send the Edit-tool diff;
 * the WYSIWYG sends its whole re-serialized source (the splice is derived by
 * prefix/suffix diff — sound because stored source is canonical).
 */
export interface EditInput {
  documentUpdate?:DocumentUpdate;
  /**
   * The caller answers with the patch, not the document, when the patch lands where it was prepared (the browser
   * editor's save): the commit then never returns or decodes the new document, and the outcome says `withheld`.
   */
  patchEcho?: true;
  operations?:DocumentOperation[];
  text?: ProseOperation;
  annotationOps?: AnnotationOperation[];
  baseEditId: string;
  /** The content change, if this edit has one. */
  change?: { oldString: string; newString: string } | { newSource: string } | { edits: StringEdit[] };
  /**
   * Document-level attributes. Deliberately NOT node-scoped: a title or theme
   * belongs to the whole document, has no span to conflict on, and (for theme)
   * recompiles the stylesheet — so these apply to head and never reject, which
   * is what lets the editor persist a theme flip while an agent is writing.
   */
  meta?: { title?: string | null; theme?: string | null; colorMode?: 'light' | 'dark' | null };
}

/**
 * The resolution outcomes. `null` keeps the
 * uniform-404 contract: unknown and foreign ids are indistinguishable.
 * Candidate markup that fails validation returns the publish pipeline's 400
 * Response unchanged (same shape as parseContentInput).
 */
export type EditOutcome =
  /**
   * `withheld`: the row carries no document or source. `remotePatches`: the patch landed on a newer head than its
   * base; these are the logged patches of the versions between, in order (absent when the log cannot yield them all).
   */
  | { applied: true; row: ArtifactRow; withheld?: true; remotePatches?: RemotePatch[] }
  | { applied: false; reason: 'stale_edit_id' | 'doc_changed'; head: { editId: string; source: string; version: number } }
  | { applied: false; reason: 'bad_diff'; detail: 'no_match' | 'multiple_matches' | 'identical' | 'empty_batch' | 'too_many_edits' | 'too_large'; editIndex?: number }
  | { applied: false; reason: 'not_editable' }; // data tiers are values, not documents

/**
 * Save-less editing writes constantly, so `artifact_versions` snapshots
 * coalesce: the first edit after this much quiet archives the pre-edit state,
 * everything inside the burst rides on it. The decision is made in SQL (a NOT
 * EXISTS over the edit log) so it costs no extra round trip.
 */

/** How many times a lost CAS race is retried before we give up and report the conflict. */
export const MAX_STALE_EDITS = 200;

/**
 * After a patch commit, whose final source only exists once the database has
 * applied it: compile that source under its owner's reach and store the
 * record beside it — unless the row has moved on, in which case the next read
 * recompiles. A source that no longer compiles (an import changed shape)
 * stores nothing, and its reads report it.
 */
async function storeCompiledRecord(db: Queryable, row: ArtifactRow): Promise<ArtifactRow> {
  if (row.format !== 'markup' || !row.source || storedCompiledDataflow(row.meta, row.source)) return row;
  const compiled = await compiledForRow(row).catch(() => null);
  if (!compiled || isEmptyCompiled(compiled)) return row;
  const meta = finalizeArtifactMetadata('markup', row.source, { ...row.meta, [COMPILED_DATAFLOW]: compiled } as Record<string, unknown>);
  if (!meta.parsedArtifact) return row;
  const stored = await db.query("UPDATE artifacts SET meta = jsonb_set(meta, '{parsedArtifact}', $3::jsonb) WHERE id = $1 AND version = $2 AND deleted_at IS NULL", [row.id, row.version, JSON.stringify(meta.parsedArtifact)]);
  return stored.rowCount ? { ...row, meta } : row;
}

/**
 * What a commit that WITHHELD its document still owes, done after the reply: the new head's source exists only in the
 * database, and decoding it (megabytes on a table-heavy document) is what the save must not wait for. So the head is
 * read once here, off the write's path, and gets exactly what an answered commit gets inline: its dataflow record
 * (storeCompiledRecord, guarded on the version), its diagram harvest, then the warm prepared page. A head that has
 * moved on is skipped: the newer commit settles its own head, and readers compile and queue on a miss anyway.
 * Serial, in commit order, and never inside a transaction (one PGLite connection).
 */
let settling: Promise<void> = Promise.resolve();
function settleCommittedHead(id: string, version: number): void {
  // Chained on a microtask, not a timer: a test's fake clock must never strand it. Its first step is a query, so the
  // reply is written while the document is read.
  settling = settling.then(async () => {
    try {
      const db = await getDb();
      const head = (await artifactQuery<ArtifactRow>(db, `SELECT * FROM artifacts WHERE id=$1 AND version=$2 AND ${LIVE_ARTIFACT_SQL}`, [id, version])).rows[0];
      if (!head) return;
      const row = await storeCompiledRecord(db, head);
      await queueMermaidHarvest(row);
      if (row.format === 'markup') warmPreparedPage(row.id, row);
    } catch (error) {
      console.warn('[edits] could not settle the committed head', id, version, (error as Error).message);
    }
  });
}

/** Resolves once every withheld commit so far has been settled (tests, and a graceful shutdown). */
export function committedHeadsSettled(): Promise<void> {
  return settling;
}

const headOf = (row: ArtifactRow) => ({ editId: row.edit_id, source: row.source ?? '', version: row.version });

/** One logged commit's patch, admitted at `version - 1` (lib/story/graph advanceGraph replays it). */
export interface RemotePatch { version: number; patch: GraphPatch }
/** Beyond this many versions between, the editor reads the head instead. */
const MAX_REMOTE_PATCHES = 50;

/**
 * The patches every commit between `baseVersion` and `headVersion` (both exclusive) applied, read from the edit log
 * (`document_state.forward`, logged by the commit that admitted it). Replayed in order on the graph at `baseVersion`
 * they give the graph the newer head was built on, without sending or decoding the document. Null when any version
 * between has no logged patch (a replacement, a conversion), or there are too many: the caller then reads the head.
 */
async function patchesSince(db: Queryable, id: string, baseVersion: number, headVersion: number): Promise<RemotePatch[] | null> {
  const count = headVersion - baseVersion - 1;
  if (count <= 0) return count === 0 ? [] : null;
  if (count > MAX_REMOTE_PATCHES) return null;
  const rows = (await db.query<{ version: number | null; kind: string | null; forward: GraphPatch | null; replaced: boolean }>(
    `SELECT (document_state->>'version')::int AS version,document_state->>'kind' AS kind,document_state->'forward' AS forward,
      COALESCE(document_state->'replacement','null'::jsonb)<>'null'::jsonb AS replaced
     FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq DESC LIMIT $2`, [id, count + 8])).rows;
  const byVersion = new Map(rows.filter((r) => r.version !== null && r.version > baseVersion && r.version < headVersion).map((r) => [r.version!, r]));
  const patches: RemotePatch[] = [];
  for (let version = baseVersion + 1; version < headVersion; version++) {
    const row = byVersion.get(version);
    if (!row || row.kind !== 'operations' || row.replaced || !row.forward) return null;
    patches.push({ version, patch: row.forward });
  }
  return patches;
}

/**
 * AN EDIT NEVER MIXES DATA SYNTAXES. A document the migration has not reached
 * (lib/story/data/data-syntax) refuses the edit's commit, and is converted first,
 * as its own version by no actor (lib/sqlite-syntax-migration
 * convertArtifactNow); the edit then meets the ordinary stale head, and the
 * client re-reads the converted document and prepares again. A document with
 * nothing to convert is marked in place, and one that needs a person is left
 * as it stands: for those the edit is committed after all. Null when the edit
 * should commit.
 */
async function convertForEdit(db: Db, id: string): Promise<ArtifactRow | null> {
  const outcome = await convertArtifactNow(db, id);
  return outcome?.outcome === 'converted' ? getArtifactById(id) : null;
}

/** Clients own semantic validation and patch preparation. This boundary owns
 * authorization and the atomic operation/dependency/history commit. */
export async function applyEditScoped(actor: TokenActor, id: string, input: EditInput, opts: { scope?: Scope; dryRun?:boolean } = {}): Promise<EditOutcome | Response | null> {
  const db = await getDb();
  const scope = opts.scope ?? editorScope(actor);
  if(input.documentUpdate){
    const update=input.documentUpdate;
    if(!update.whole&&!Object.keys(update.patch.updated).length&&!Object.keys(update.patch.inserted).length&&!update.patch.removed.length&&!Object.keys(update.metadata??{}).length&&!Object.keys(update.settings??{}).length&&!update.annotationOps?.length&&!update.aliases?.length&&!update.datasetBindings?.length)return json({error:'bad_diff',detail:'identical'},400);
    if(input.documentUpdate.settings?.visibility==='public'&&!ALLOW_PUBLIC_VISIBILITY)return json({error:'public_not_enabled'},400);
    const withholdDocument=!!input.patchEcho&&!opts.dryRun;
    let committed=await commitDocumentUpdate(db,actor,scope,id,input.documentUpdate,{dryRun:opts.dryRun,currentSyntax:!opts.dryRun,withholdDocument});
    if(!committed)return null;
    // Only an editor gets here with a head: the commit already applied the scope.
    if(!committed.applied&&!opts.dryRun&&committed.head.format==='markup'&&!hasCurrentDataSyntax(committed.head.meta)){
      const converted=await convertForEdit(db,id);
      if(converted)return {applied:false,reason:'doc_changed',head:headOf(converted)};
      committed=await commitDocumentUpdate(db,actor,scope,id,input.documentUpdate,{withholdDocument});
      if(!committed)return null;
    }
    if(!committed.applied&&committed.head.dataset_policy&&update.whole)return policyLocked('a dataset with a write policy cannot be replaced by a document');
    if(!committed.applied&&committed.head.format!=='markup')return {applied:false,reason:'not_editable'};
    if(!committed.applied&&committed.ownerOnly)return json({error:'owner_only'},403);
    if(!committed.applied&&committed.invalidParent)return json({error:'invalid_parent'},400);
    if(!committed.applied&&committed.refusal)return json({error:'mention_refused',detail:committed.refusal},403);
    if(!committed.applied&&input.documentUpdate.settings?.visibility==='private'&&!committed.head.user_id)return json({error:'private_requires_account'},400);
    if(opts.dryRun)return committed.applied?json({valid:true,dry_run:true,commit_checks:['authorization','dependency_revisions','metadata','sharing','size']}):json({error:'doc_changed'},409);
    if(!committed.applied)return {applied:false,reason:'doc_changed',head:headOf(committed.head)};
    if(committed.withheld){
      settleCommittedHead(committed.row.id,committed.row.version);
      const remotePatches=committed.row.version===update.patch.baseVersion+1?null:await patchesSince(db,id,update.patch.baseVersion,committed.row.version);
      return {applied:true,row:committed.row,withheld:true,...(remotePatches?{remotePatches}:{})};
    }
    const row=await storeCompiledRecord(db,committed.row);
    // After the commit, off the write's path: the new head is prepared for its readers, and its diagrams harvested.
    if(row.format==='markup')warmPreparedPage(row.id);
    void queueMermaidHarvest(row);
    return {applied:true,row};
  }


  return json({error:'jsonb_operations_required',hint:'Prepare document_update from the graph returned by the last read. Use the current CLI or browser editor.'},400);
}

// ── The reference graph ──────────────────────────────────────────────────────

/**
 * A ref target ANY caller may use: link-readable, exactly the anonymous
 * viewer's cut of canReadArtifact. Assets and documents routinely land under
 * different identities (two agent sessions each on their own anonymous token;
 * an unclaimed upload referenced from an account-owned doc), and anonymous
 * assets are born public — so ownership-scoping made "publish the image, then
 * reference it" fail for no reason the user could see. PRIVATE stays invisible
 * cross-identity: the same uniform "does not resolve" as a nonexistent id,
 * never an existence oracle.
 */
export async function getLinkReadableArtifact(id: string): Promise<ArtifactRow | null> {
  const row = await getArtifactById(id);
  return row && (grantsOf(row)?await grantsPermitRead(row,{userId:null,tokenId:null}):row.visibility !== 'private') ? row : null;
}

/** Resolve a `ref:<id>`: the caller's own artifacts, then anything link-readable. */
export function refLoaderFor(tokenId: string): RefLoader {
  return async (id: string): Promise<ResolvedRef | null> => {
    // `owned` records WHICH branch answered: a read is happy either way, a
    // <Mutation> is admitted only for the caller's own (lib/story/data/refs).
    const own = await getArtifact(tokenId, id);
    const row = own ?? (await getLinkReadableArtifact(id));
    if (!row) return null;
    return rowToResolvedRef(row, !!own);
  };
}

/** Same, scoped by account (the session-authed /api/my routes) before the link-readable fallback. */
export function refLoaderForUser(userId: string): RefLoader {
  return async (id: string): Promise<ResolvedRef | null> => {
    const own = await getArtifactFor({userId,tokenId:''}, id);
    const row = own ?? (await getLinkReadableArtifact(id));
    if (!row) return null;
    return rowToResolvedRef(row, !!own);
  };
}

/**
 * The byte quota as the publish door asks it: "is this caller already over?"
 *
 * A closure over the identity, so lib/story/document/input can guard a tier without
 * knowing who is publishing. The
 * subject is the ACCOUNT when the token has one — a cap keyed on the token
 * alone is bypassed by minting a second one — which lib/asset-quota decides,
 * not this.
 *
 * Its ABSENCE is also what tells the byte tiers they are being previewed:
 * every other ctx member degrades to "do less", and storing the bytes IS what
 * publishing an image or a PDF is, so those two refuse by name instead of
 * quietly working for free (lib/story/document/input).
 */
export function byteQuotaFor(tokenId: string): () => Promise<boolean> {
  return () => assetByteQuotaExceeded(tokenId);
}

/**
 * The publish door's font resolver: a family the document names becomes faces
 * copied into our object store (lib/webfonts), once per deployment. Failure is
 * a 400 that NAMES the family — the same stance the image door takes, and for
 * the same reason: a silent fallback renders as "it worked".
 */
export function fontResolver(): (family: string) => Promise<Response | null> {
  return async (family) => {
    try {
      await resolveWebFont(family);
      return null;
    } catch (error) {
      if (error instanceof UnknownFontError) {
        return json({ error: 'unknown_font', details: [error.message] }, 400);
      }
      throw error;
    }
  };
}

/** The actor's REACH: what they own, and what they are named editor on. */
export function getArtifactFor(actor: TokenActor, id: string): Promise<ArtifactRow | null> {
  return getArtifactScoped(editorScope(actor), id);
}

/** What the actor OWNS — the read behind every owner-only surface (sharing, metadata, delete). */
export function getOwnedArtifactFor(actor: TokenActor, id: string): Promise<ArtifactRow | null> {
  return getArtifactScoped(ownerScope(actor), id);
}

/** Stable keyset pagination; creation timestamps never move when content is edited. */
interface ArtifactCollectionFilters {type?:'artifact'|'folder'|'dataset'|'file';visibility?:'private'|'unlisted'|'public';relationship?:'all'|'owned'|'shared';search?:string;parent_id?:string}
export async function listArtifactPageFor(actor: TokenActor, limit: number, cursor?: {created: string; id: string}, filters:ArtifactCollectionFilters={}): Promise<{rows: ArtifactSummary[]; next?: {created: string; id: string}}> {
  const owner=ownerPredicate(actor);const values:unknown[]=[owner.val,limit+1];
  const shared=actor.userId?SHARE_PREDICATE(['viewer','commenter','editor'],'$1'):'FALSE';
  const relationship=filters.relationship??'all';
  const reach=relationship==='owned'?owner.where('$1'):relationship==='shared'?`(${shared} AND NOT (${owner.where('$1')}))`:`(${owner.where('$1')} OR ${shared})`;
  const predicates=[LIVE_ARTIFACT_SQL,`(${reach})`];
  const bind=(value:unknown)=>{values.push(value);return '$'+values.length;};
  if(cursor)predicates.push(`(created_at,id)<(${bind(cursor.created)}::timestamptz,${bind(cursor.id)})`);
  if(filters.type)predicates.push(`format=ANY(${bind(filters.type==='file'?['image','pdf','file']:[filters.type==='artifact'?'markup':filters.type])}::text[])`);
  if(filters.visibility)predicates.push(`visibility=${bind(filters.visibility)}`);
  if(filters.search)predicates.push(`position(lower(${bind(filters.search)}) in lower(COALESCE(title,'')))>0`);
  if(filters.parent_id)predicates.push(`ancestor_ids[array_length(ancestor_ids,1)]=${bind(filters.parent_id)}`);
  const result=await (await getDb()).query<ArtifactSummary & {page_created:string}>(`SELECT ${SUMMARY_COLS},created_at::text AS page_created FROM artifacts WHERE ${predicates.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT $2`,values);
  const rows=result.rows.slice(0,limit),last=rows.at(-1);
  return {rows,...(result.rows.length>limit&&last?{next:{created:last.page_created,id:last.id}}:{})};
}

export function listArtifactsFor(actor: TokenActor): Promise<ArtifactSummary[]> {
  return listArtifactsScoped(ownerScope(actor));
}

export function replaceArtifactFor(actor: TokenActor, id: string, input: ArtifactInput, opts: ReplaceOpts = {}): Promise<ArtifactRow | VersionConflict | Response | null> {
  return replaceScoped(actor, id, input, opts);
}

export function applyEditFor(actor: TokenActor, id: string, input: EditInput, opts: { scope?: Scope; dryRun?:boolean } = {}): Promise<EditOutcome | Response | null> {
  return applyEditScoped(actor, id, input, opts);
}

export async function listVersionPageFor(actor: TokenActor, id: string, limit: number, before?: number, through?:number, filters:{author?:string;since?:string;until?:string}={}): Promise<{rows: VersionSummary[]; next?: number} | null> {
  const scope = editorScope(actor);
  const db = await getDb();
  // Keep authorization and the head/history snapshot in one statement.
  const result = await db.query<VersionSummary & {visible: boolean}>(`
    WITH head AS (SELECT * FROM artifacts WHERE id=$1 AND ${scope.where('$2')}),
    history AS (
      SELECT version,title,description,format,actor_user_id,updated_at AS created_at FROM head
      UNION ALL
      SELECT v.version,v.title,v.description,v.format,v.actor_user_id,v.created_at
      FROM artifact_versions v WHERE v.artifact_id=$1 AND EXISTS (SELECT 1 FROM head)
    )
    SELECT h.version,h.title,h.description,h.format,u.username AS by,h.created_at,true AS visible
    FROM history h LEFT JOIN users u ON u.id=h.actor_user_id
    WHERE ($4::bigint IS NULL OR h.version < $4) AND ($5::bigint IS NULL OR h.version <= $5)
      AND ($6::text IS NULL OR u.username = $6) AND ($7::timestamptz IS NULL OR h.created_at >= $7) AND ($8::timestamptz IS NULL OR h.created_at <= $8)
    ORDER BY h.version DESC LIMIT $3`,
    [id, scope.val, limit + 1, before ?? null,through??null,filters.author??null,filters.since??null,filters.until??null]);
  if (!result.rows.length) {
    const visible = await db.query(`SELECT 1 FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`, [id, scope.val]);
    if (!visible.rows.length) return null;
  }
  const rows = result.rows.slice(0, limit).map(({visible: _visible, ...row}) => row);
  return {rows, ...(result.rows.length > limit ? {next: rows.at(-1)!.version} : {})};
}

export function listVersionsFor(actor: TokenActor, id: string): Promise<VersionSummary[] | null> {
  return listVersionsScoped(editorScope(actor), id);
}

export function getVersionFor(actor: TokenActor, id: string, version: number): Promise<VersionContent | null> {
  return getVersionScoped(editorScope(actor), id, version);
}

/**
 * The version a CAPTURE photographs, in the ROW OWNER's own scope.
 *
 * The exporter shoots the served document in a headless browser that holds no
 * session: it carries the short-lived signed key instead (lib/export-key), and
 * the version ACL for that shot already ran at the export door, on the actor
 * who asked, BEFORE the key was minted. So the render has nothing left to
 * prove with, and this resolves the version as the artifact's own owner —
 * never as the requester, and never without a scope.
 *
 * Only a caller that has verified an export key for THIS row may use it.
 */
export function versionForCapture(row: Pick<ArtifactRow, 'id' | 'user_id' | 'token_id'>, version: number): Promise<VersionContent | null> {
  return getVersionScoped(editorScope({ userId: row.user_id, tokenId: row.token_id }), row.id, version);
}

export function revertArtifactFor(actor: TokenActor, id: string, version: number, opts: ReplaceOpts = {}): Promise<ArtifactRow | null | VersionNotArchived> {
  return revertScoped(actor, id, version, opts);
}

/** What a METADATA write may change: policy ABOUT a row, never its content. */
export interface MetadataPatch {
  policy?:DatasetPolicy|null;
  shares?:ShareEntry[];
  title?: string | null;
  description?: string | null;
  visibility?: Visibility;
  access?: DatasetAccess;
  ancestor_ids?: string[];
  link_role?: ShareRole;
  theme?: string | null;
  template?: string | null;
  colorMode?: 'light' | 'dark' | null;
}

/** Metadata commits as one observed-state transaction, without a content version. */
export function setMetadataFor(actor: TokenActor, id: string, patch: MetadataPatch): Promise<ArtifactRow | null>;
export function setMetadataFor(actor: TokenActor, id: string, patch: MetadataPatch, opts: ReplaceOpts & {allowEditor?:boolean;dryRun?:boolean}): Promise<ArtifactRow | VersionConflict | null>;
export async function setMetadataFor(actor: TokenActor, id: string, patch: MetadataPatch, opts: ReplaceOpts & {allowEditor?:boolean;dryRun?:boolean} = {}): Promise<ArtifactRow | VersionConflict | null> {
  const db = await getDb();
  const scope = opts.allowEditor?editorScope(actor):ownerScope(actor);
  let moved: {from: string | null; to: string | null} | null = null;
  const result = await db.transaction<ArtifactRow | VersionConflict | null>(async tx => {
    const current = (await artifactQuery<ArtifactRow>(tx,`SELECT * FROM artifacts WHERE id=$1 AND ${scope.where('$2')} FOR UPDATE`, [id,scope.val])).rows[0];
    if (!current) return null;
    if(current.format==='markup')return null;
    if (opts.expectedState !== undefined && artifactState(current) !== opts.expectedState) return {conflict:true,reason:'state_conflict',currentVersion:current.version,currentState:artifactState(current)};
    if (opts.expectedVersion !== undefined && current.version !== opts.expectedVersion) return {conflict:true,currentVersion:current.version};
    if(patch.policy!==undefined&&current.policy_revision!==opts.expectedPolicyRevision)return {conflict:true,reason:'state_conflict',currentVersion:current.version,currentState:artifactState(current)};
    const policy=patch.policy===undefined?undefined:validateDatasetPolicyForRow(current,patch.policy);
    if (patch.access && (current.format !== 'dataset' || (patch.access === 'readwrite' && catalogOf(current)?.kind === 'postgres'))) return null;
    const meta = {...current.meta};
    for (const key of ['theme','template','colorMode'] as const) if (patch[key] !== undefined) meta[key] = patch[key];
    if(opts.dryRun)return {...current,...patch,meta};
    const updated = (await artifactQuery<ArtifactRow>(tx,`UPDATE artifacts SET title=$3,description=$4,meta=$5::jsonb,
      visibility=$6,access=$7,ancestor_ids=$8::text[],link_role=$9,updated_at=now(),actor_user_id=$10,actor_token_id=$11
      WHERE id=$1 AND ${scope.where('$2')} RETURNING *`, [id,scope.val,
      patch.title === undefined ? current.title : patch.title?.trim() ?? null,
      patch.description === undefined ? current.description : patch.description,
      JSON.stringify(meta),patch.visibility ?? current.visibility,patch.access ?? current.access,
      patch.ancestor_ids ?? current.ancestor_ids,patch.link_role ?? current.link_role,...actorStamp(actor),
    ])).rows[0];
    if(patch.shares!==undefined)Object.assign(updated,await writeShares(tx,id,patch.shares));
    else updated.shares=(await tx.query<ShareEntry>('SELECT email,role FROM artifact_shares WHERE artifact_id=$1 ORDER BY email',[id])).rows;
    if(policy!==undefined){
     const changed=await tx.query<{dataset_policy:DatasetPolicy|null;policy_revision:number}>(`WITH changed AS (
      UPDATE artifacts SET dataset_policy=$2::jsonb,policy_revision=policy_revision+1 WHERE id=$1 RETURNING *
     ), audit AS (
      INSERT INTO dataset_policy_audit(dataset_id,revision,policy,actor_user_id,actor_token_id)
      SELECT id,policy_revision,dataset_policy,$3,$4 FROM changed
     ) SELECT dataset_policy,policy_revision FROM changed`,[id,JSON.stringify(policy),actor.userId,actor.tokenId]);
     Object.assign(updated,changed.rows[0]);
    }
    if (patch.ancestor_ids && current.format === 'folder') {
      const swap = ancestorsForMove(current,patch.ancestor_ids);
      await tx.query(swap.sql,swap.params);
    }
    if (patch.ancestor_ids) moved = {from:parentOf(current),to:parentOf(updated)};
    return updated;
  });
  if (result && !isVersionConflict(result) && !opts.dryRun) {
    if (moved) {await wakeParents(moved);sayMoved(actor,id,moved);}
    else await notifyParent(parentOf(result));
    if (patch.access || patch.visibility || patch.link_role || patch.shares || patch.policy!==undefined) await db.query('SELECT pg_notify($1,$2)',[channelFor(id),result.edit_id]);
  }
  return result;
}
