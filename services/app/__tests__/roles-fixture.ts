/**
 * The roles suites' shared fixture (roles*.test.ts): accounts, documents at a visibility and link role, sharing and
 * membership helpers. Each suite calls useAppHarness itself.
 */
import { nativeHtml } from '@/__tests__/native-html-fixture';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { type ArtifactRow, createArtifact, updateSharingFor } from '@/lib/artifacts';
import { artifactQuery } from '@/lib/artifacts/table';
import { type ShareRole, type Visibility, type Queryable } from '@artifactbin/contracts';
import { identityForUser, createUser } from '@/lib/accounts';
import { getDb } from '@/lib/platform';

export const setUserEmail = async (userId: string, email: string) => { await (await getDb()).query('UPDATE users SET email = $2 WHERE id = $1', [userId, email]); };

/**
 * ROLES — who may read, comment, edit, govern and join an artifact, in one file over one database.
 *
 * Merged from access-lattice, general-access, collab-commenters, editor-sharing, collab-editors and membership
 * (one harness boot instead of six). The lattice and `effectiveRole` are TABLES: every case those files asserted,
 * each once, as a row naming who asks, of what, and what they get. The doors are tested through the real routes
 * in the describes after them, each keeping the fixtures it was written with.
 *
 *   THE LATTICE — one ordered vocabulary (none < viewer < commenter < editor < owner); every capability is a
 *   comparison on it, an unknown value fails closed, and anonymous caps at viewer.
 *   EFFECTIVE ROLE — ownership, the named shares and the link, composed by max. `visibility` answers REACH and
 *   listing, `link_role` what the link's holder may DO; a row written before the column reads as viewer.
 */

export const SOURCE = '<div id="root" data-af-id="root"><p>hello</p></div>';

/** An account plus one of its claimed tokens — the ordinary signed-in owner. */
export async function account(email: string) {
  const user = await createUser({ email });
  const token = await mintToken(email, user.id);
  return { user, token };
}
export type Account = Awaited<ReturnType<typeof account>>;

export async function head(id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  const r = await artifactQuery<ArtifactRow>(db, 'SELECT * FROM artifacts WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

/** A document of `owner` at `visibility`, its link carrying `linkRole` when one is given. */
export async function docOf(owner: Account, visibility: Visibility, linkRole?: ShareRole): Promise<ArtifactRow> {
  const row = await createArtifact(owner.token.id, owner.user.id, { format: 'html', source: nativeHtml(SOURCE), meta: {}, visibility, title: 't' });
  if (!linkRole) return row;
  await updateSharingFor(identityForUser(owner.user.id, ''), row.id, { linkRole });
  return (await head(row.id))!;
}

/** A row exactly as it was written before the column existed. */
export async function clearLinkRole(id: string): Promise<ArtifactRow> {
  const db = await getDb();
  await artifactQuery(db, 'UPDATE artifacts SET link_role = NULL WHERE id = $1', [id]);
  return (await head(id))!;
}

export const shareWith = (owner: Account, row: ArtifactRow, email: string, role: ShareRole) =>
  updateSharingFor(identityForUser(owner.user.id, ''), row.id, { shares: [{ email, role }] });

/** Nobody at all — the anonymous visitor holding only the address. */
/** The recipient holds a live, explicit (self-consented) join of this artifact. */
export const explicitlyJoined = async (db: Queryable, documentId: string, userId: string) =>
  (await db.query("SELECT 1 FROM relations WHERE subject_kind='user' AND subject_id=$2 AND verb='join' AND object_kind='artifact' AND object_id=$1 AND status='accepted' AND deleted_at IS NULL AND explicit_join=true", [documentId, userId])).rows.length > 0;
export const STRANGER = identityForUser(null, null);
export const SHARE_ROLE_LIST: ShareRole[] = ['viewer', 'commenter', 'editor'];
