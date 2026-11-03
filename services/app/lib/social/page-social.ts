/**
 * THE SOCIAL CHROME of a document's page (lib/document-serving artifact-page), in ONE statement: the author's handle
 * and face, the like count and whether the reader liked it, the author's follower count and whether the reader
 * follows them, and the page's open comment threads. Each was its own round trip; a page view asked all six.
 *
 * Every relation predicate is the one ./relations asks (`has`, `count`), with the verb and object kind INLINED for
 * the same reason as there: the partial indexes carry those literals. The open-thread count is
 * lib/annotations `countOpenAnnotations`'s: a live root whose status is open.
 */
import { RELATION_EVENTS } from '@artifactbin/contracts';
import { getDb } from '@/lib/platform';

interface PageSocial {
  /** The author's row as the byline draws it, or null for a row without an account. */
  author: { id: string; username: string | null; image_key: string | null } | null;
  liked: boolean;
  likeCount: number;
  following: boolean;
  followCount: number;
  openAnnotations: number;
}

const LIKE = RELATION_EVENTS.like.object, FOLLOW = RELATION_EVENTS.follow.object;
const live = `deleted_at IS NULL AND status = 'accepted'`;
const SQL = `SELECT u.id AS author_id, u.username AS author_username, u.image_key AS author_image_key,
  EXISTS (SELECT 1 FROM relations WHERE subject_kind = 'user' AND subject_id = $3::text AND verb = 'like' AND object_kind = '${LIKE}' AND object_id = $1::text AND ${live}) AS liked,
  (SELECT COUNT(*) FROM relations WHERE verb = 'like' AND object_kind = '${LIKE}' AND object_id = $1::text AND ${live}) AS like_count,
  EXISTS (SELECT 1 FROM relations WHERE subject_kind = 'user' AND subject_id = $3::text AND verb = 'follow' AND object_kind = '${FOLLOW}' AND object_id = $4::text AND ${live}) AS following,
  (SELECT COUNT(*) FROM relations WHERE verb = 'follow' AND object_kind = '${FOLLOW}' AND object_id = $4::text AND ${live}) AS follow_count,
  CASE WHEN $5::boolean THEN (SELECT COUNT(*) FROM annotations WHERE artifact_id = $1::text AND root_id IS NULL AND status = 'open' AND deleted_at IS NULL) ELSE 0 END AS open_annotations
FROM (SELECT 1) AS page LEFT JOIN users u ON u.id = $2::text`;

interface Row {
  author_id: string | null; author_username: string | null; author_image_key: string | null;
  liked: boolean; like_count: string | number; following: boolean; follow_count: string | number; open_annotations: string | number;
}

/**
 * `viewerId` is the signed-in reader (null for anonymous: nothing is theirs). The follow control is the author's,
 * and only for someone else: an owner reading their own page, or a page without an author, has none (0, false).
 * `annotations`: whether the page counts comment threads (a document does).
 */
export async function pageSocial(input: { artifactId: string; authorId: string | null; viewerId: string | null; annotations: boolean }): Promise<PageSocial> {
  const { artifactId, authorId, viewerId, annotations } = input;
  const followed = authorId && authorId !== viewerId ? authorId : null;
  const db = await getDb();
  const row = (await db.query<Row>(SQL, [artifactId, authorId, viewerId, followed, annotations])).rows[0]!;
  return {
    author: row.author_id ? { id: row.author_id, username: row.author_username, image_key: row.author_image_key } : null,
    liked: row.liked === true,
    // COUNT() comes back as a bigint, which both drivers hand over as a string.
    likeCount: Number(row.like_count),
    following: row.following === true,
    followCount: Number(row.follow_count),
    openAnnotations: Number(row.open_annotations),
  };
}
