/**
 * ONE ROW, read: the unscoped lookup the public serving paths decide on, the scoped reads an actor's
 * reach, ownership or the link admits, and the head an editor edits. Every read carries the trash gate
 * (./table). Below access and the write path, so both can read a row without a cycle.
 */
import type { AccessActor } from '@/lib/accounts';
import { ANONYMOUS_ACTOR } from '@/lib/accounts';
import { getDb } from '../platform/db';
import { artifactQuery, loadArtifactDocument } from './document';
import { grantsOf, grantsPermitRead } from './dataset-policy/grants';
import { servableDocument } from './servable';
import { LIVE_ARTIFACT_SQL, editorScope, ownerScope, type ArtifactRow, type Scope } from './table';

/** A row without its content: every column but the two that carry it, `document` and `source`. */
export type ArtifactHeader = Omit<ArtifactRow, 'document' | 'source'>;
/**
 * The header's columns, spelled out because Postgres cannot say "all but". A column added to `artifacts` must be named
 * here, or a decision read from a header could consult a column it never loaded: the schema test
 * (__tests__/artifact-header.test.ts) fails on any drift.
 */
export const ARTIFACT_HEADER_COLUMNS = [
  'id', 'token_id', 'user_id', 'group_id', 'creator_user_id', 'visibility', 'dataset_policy', 'sharing_revision', 'policy_revision',
  'link_role', 'access', 'ancestor_ids', 'title', 'description', 'format', 'document_archived_at', 'meta', 'version', 'edit_id',
  'actor_user_id', 'actor_token_id', 'created_at', 'updated_at', 'forked_from', 'deleted_at',
] as const;
const HEADER_SELECT = ARTIFACT_HEADER_COLUMNS.join(', ');

export async function getArtifact(tokenId: string, id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  return loadArtifactDocument<ArtifactRow>(db,`SELECT * FROM artifacts WHERE id = $1 AND group_id IS NULL AND token_id = $2 AND (user_id IS NULL OR user_id=(SELECT user_id FROM tokens WHERE tokens.id=$2)) AND ${LIVE_ARTIFACT_SQL}`, [id, tokenId]);
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

/**
 * The row's header — everything an access or role decision reads, and not the document: a JSONB value that is
 * megabytes for a large page, which the database would otherwise ship and the server decode just to be told no
 * (or to decide a role). Same trash gate and same row as {@link getArtifactById}.
 */
export async function getArtifactHeaderById(id: string): Promise<ArtifactHeader | null> {
  const db = await getDb();
  return (await db.query<ArtifactHeader>(`SELECT ${HEADER_SELECT} FROM artifacts WHERE id = $1 AND ${LIVE_ARTIFACT_SQL}`, [id])).rows[0] ?? null;
}

/**
 * Did the row's ACCESS change between the header an admission decided on and the whole row read after it? Then the
 * admission is asked again of the row that is served.
 */
export const accessMoved = (decided: ArtifactHeader, loaded: ArtifactHeader): boolean =>
  decided.visibility !== loaded.visibility || decided.link_role !== loaded.link_role || decided.user_id !== loaded.user_id
  || (decided.group_id ?? null) !== (loaded.group_id ?? null) || decided.token_id !== loaded.token_id || (decided.sharing_revision ?? 0) !== (loaded.sharing_revision ?? 0);

/**
 * Does the actor's reach (the same editor scope as {@link getArtifactFor}) include this row, and is it shared with
 * anyone? One EXISTS instead of loading the row and its share list to test `shares.length > 0`.
 */
export async function hasInvitedUsersFor(actor: AccessActor, id: string): Promise<boolean> {
  const db = await getDb();
  const scope = editorScope(actor);
  const found = await db.query<{ shared: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM artifact_shares s WHERE s.artifact_id = artifacts.id) AS shared FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`,
    [id, scope.val],
  );
  return found.rows[0]?.shared === true;
}

/** The actor's reach over several rows at once ({@link getArtifactFor}'s scope, `id = ANY`): the ones they own or may edit, without share lists. */
export async function getArtifactsFor(actor: AccessActor, ids: readonly string[]): Promise<ArtifactRow[]> {
  if (!ids.length) return [];
  const db = await getDb();
  const scope = editorScope(actor);
  return (await artifactQuery<ArtifactRow>(db, `SELECT * FROM artifacts WHERE id = ANY($1::text[]) AND ${scope.where('$2')}`, [[...ids], scope.val])).rows;
}

/** {@link getLinkReadableArtifact} for several ids in one read: the rows any caller may use, in the order the database returns them. */
export async function getLinkReadableArtifacts(ids: readonly string[]): Promise<ArtifactRow[]> {
  if (!ids.length) return [];
  const db = await getDb();
  const rows = (await artifactQuery<ArtifactRow>(db, `SELECT * FROM artifacts WHERE id = ANY($1::text[]) AND ${LIVE_ARTIFACT_SQL}`, [[...ids]])).rows;
  const readable: ArtifactRow[] = [];
  for (const row of rows) if (grantsOf(row) ? await grantsPermitRead(row, ANONYMOUS_ACTOR) : row.visibility !== 'private') readable.push(row);
  return readable;
}

const SHARES_PROJECTION="COALESCE((SELECT jsonb_agg(jsonb_build_object('email',s.email,'role',s.role) ORDER BY s.email) FROM artifact_shares s WHERE s.artifact_id=artifacts.id),'[]'::jsonb) AS shares";

async function getArtifactScoped(scope: Scope, id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  return loadArtifactDocument<ArtifactRow>(db,`SELECT artifacts.*, ${SHARES_PROJECTION} FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val]);
}

/**
 * The head an EDITOR reads to edit (the CLI pull, the browser editor's load):
 * one the current code no longer reads throws UnservableDocument
 * (lib/artifacts/servable), so an author never edits a retired shape.
 */
export async function getEditableArtifactFor(actor: AccessActor, id: string): Promise<ArtifactRow | null> {
  const row = await getArtifactFor(actor, id);
  return row && servableDocument(row);
}

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
  return row && (grantsOf(row)?await grantsPermitRead(row,ANONYMOUS_ACTOR):row.visibility !== 'private') ? row : null;
}

/** The actor's REACH: what they own, and what they are named editor on. */
export function getArtifactFor(actor: AccessActor, id: string): Promise<ArtifactRow | null> {
  return getArtifactScoped(editorScope(actor), id);
}

/** What the actor OWNS — the read behind every owner-only surface (sharing, metadata, delete). */
export function getOwnedArtifactFor(actor: AccessActor, id: string): Promise<ArtifactRow | null> {
  return getArtifactScoped(ownerScope(actor), id);
}
