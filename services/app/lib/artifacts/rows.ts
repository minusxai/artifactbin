/**
 * ONE ROW, read: the unscoped lookup the public serving paths decide on, the scoped reads an actor's
 * reach, ownership or the link admits, and the head an editor edits. Every read carries the trash gate
 * (./table). Below access and the write path, so both can read a row without a cycle.
 */
import type { TokenActor } from '@/lib/accounts';
import { getDb } from '../platform/db';
import { loadArtifactDocument } from './document';
import { grantsOf, grantsPermitRead } from './dataset-policy/grants';
import { servableDocument } from './servable';
import { LIVE_ARTIFACT_SQL, editorScope, ownerScope, type ArtifactRow, type Scope } from './table';

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
export async function getEditableArtifactFor(actor: TokenActor, id: string): Promise<ArtifactRow | null> {
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
  return row && (grantsOf(row)?await grantsPermitRead(row,{userId:null,tokenId:null}):row.visibility !== 'private') ? row : null;
}

/** The actor's REACH: what they own, and what they are named editor on. */
export function getArtifactFor(actor: TokenActor, id: string): Promise<ArtifactRow | null> {
  return getArtifactScoped(editorScope(actor), id);
}

/** What the actor OWNS — the read behind every owner-only surface (sharing, metadata, delete). */
export function getOwnedArtifactFor(actor: TokenActor, id: string): Promise<ArtifactRow | null> {
  return getArtifactScoped(ownerScope(actor), id);
}
