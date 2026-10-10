/**
 * A person's ARTIFACT LISTINGS: their profile root, what is shared to their address, a browser's
 * drafts, their dashboard list and their tokens with what each one published. Identity (lib/accounts)
 * knows who a person is; these read the artifact tables on that person's behalf.
 */
import type { ShareRole } from '@artifactbin/contracts';
// The trash gate (lib/artifacts LIVE_ARTIFACT_SQL) is a VALUE here rather
// than an inherited predicate: these listings build their own statements
// instead of going through the row-loading seam, so each one names the gate.
import { type ArtifactSummary, LIVE_ARTIFACT_SQL } from '@/lib/artifacts';
import { LIVE_TOKEN_SQL } from '@/lib/accounts/tokens';
import { getDb } from '@/lib/platform/db';

const SUMMARY_COLS = 'id, title, description, format, meta, version, visibility, ancestor_ids, created_at, updated_at';

/** A dashboard row: the summary plus its all-time count of unique daily visitors. */
type OwnedArtifactSummary = ArtifactSummary & { views: number };

/**
 * The one profile view for every visitor, including its owner: public
 * root artifacts only, with no view counts. Filed artifacts belong on their
 * folder's page; they never also appear at the profile root.
 *
 * Documents and folders only: datasets, images and viz recipes are the material
 * documents are built from (bound as ref:<id>), so 'public' keeps them
 * link-reachable for the documents that embed them — but a profile that lists
 * them reads as a junk drawer, one row of supporting files per real page.
 */
export async function listPublicArtifactsByUser(userId: string): Promise<ArtifactSummary[]> {
  const db = await getDb();
  const r = await db.query<ArtifactSummary>(
    `SELECT ${SUMMARY_COLS} FROM artifacts
     WHERE user_id = $1 AND visibility = 'public' AND format IN ('markup', 'folder') AND ${LIVE_ARTIFACT_SQL}
       AND cardinality(ancestor_ids) = 0
     ORDER BY updated_at DESC LIMIT 200`,
    [userId],
  );
  return r.rows;
}

/** A row of somebody else's work, shared to this viewer's email, and what they may do with it. */
export type SharedArtifactSummary = ArtifactSummary & { owner_username: string | null; role: ShareRole };

/**
 * The recipient's side of `artifact_shares`: everything shared to this email,
 * newest first, with the owner's handle so a row can say who shared it.
 *
 * Keyed by EMAIL (shares are, so an invite can predate the account), matched
 * lowercased exactly as canReadArtifact matches the viewer. `excludeUserId`
 * keeps the viewer's own artifacts out — being on your own share list is not
 * a discovery.
 */
export async function listSharedWithEmail(email: string, excludeUserId?: string): Promise<SharedArtifactSummary[]> {
  const db = await getDb();
  const cols = SUMMARY_COLS.split(', ').map((c) => `a.${c}`).join(', ');
  const r = await db.query<SharedArtifactSummary>(
    `SELECT ${cols}, u.username AS owner_username, s.role
     FROM artifacts a
     JOIN artifact_shares s ON s.artifact_id = a.id
     LEFT JOIN users u ON u.id = a.user_id
     WHERE s.email = $1 AND ($2::text IS NULL OR a.user_id IS DISTINCT FROM $2::text) AND a.${LIVE_ARTIFACT_SQL}
     ORDER BY a.updated_at DESC LIMIT 200`,
    [email.toLowerCase().trim(), excludeUserId ?? null],
  );
  return r.rows;
}

/**
 * The drafts a browser holds: artifacts created by these LIVE tokens that NOBODY has claimed,
 * newest first, in the summary shape the signed-in home list uses. Revoked or expired credentials are
 * nothing even when a stale cookie still names them. Empty ids ⇒ empty list, no query.
 */
export async function listDraftsByTokenIds(tokenIds: string[]): Promise<OwnedArtifactSummary[]> {
  if (tokenIds.length === 0) return [];
  const db = await getDb();
  const cols = SUMMARY_COLS.split(', ').map((c) => `artifacts.${c}`).join(', ');
  const r = await db.query<OwnedArtifactSummary>(
    `SELECT ${cols},
       (SELECT COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int FROM analytics_events e
        WHERE e.artifact_id = artifacts.id AND e.event = 'view') AS views
     FROM artifacts
     WHERE artifacts.${LIVE_ARTIFACT_SQL} AND EXISTS (
       SELECT 1 FROM tokens LEFT JOIN users ON users.id = tokens.user_id
       WHERE tokens.id = ANY($1) AND ${LIVE_TOKEN_SQL}
         AND ((artifacts.user_id = tokens.user_id AND users.kind = 'guest')
           OR (artifacts.token_id = tokens.id AND artifacts.user_id IS NULL)))
     ORDER BY artifacts.updated_at DESC LIMIT 200`,
    [tokenIds],
  );
  return r.rows;
}

export async function listArtifactsByUser(userId: string): Promise<OwnedArtifactSummary[]> {
  return listOwnedArtifacts('user_id', userId);
}

/**
 * The dashboard list for whichever credential the BROWSER holds: an account
 * (`user_id`) or an anonymous token (`token_id`, lib/agent-session). One query
 * either way — the view count is what makes this list different from
 * lib/artifacts' plain summary, and an anonymous owner's dashboard would look
 * broken without it.
 *
 * The column name comes from a two-value union, never from caller input.
 */
export async function listOwnedArtifacts(col: 'user_id' | 'token_id', value: string): Promise<OwnedArtifactSummary[]> {
  const db = await getDb();
  const r = await db.query<OwnedArtifactSummary>(
    `SELECT ${SUMMARY_COLS},
       (SELECT COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int FROM analytics_events e
        WHERE e.artifact_id = artifacts.id AND e.event = 'view') AS views
     FROM artifacts WHERE ${col} = $1 AND ${LIVE_ARTIFACT_SQL} ORDER BY updated_at DESC LIMIT 200`,
    [value],
  );
  return r.rows;
}

interface UserTokenRow {
  id: string;
  name: string | null;
  artifacts: number;
  created_at: string;
  deleted_at: string | null;
}

/** The user's machine tokens (revoked ones included, so the dashboard shows history). */
export async function listAccountTokenRows(userId: string): Promise<UserTokenRow[]> {
  const db = await getDb();
  const r = await db.query<UserTokenRow & { artifacts: string | number }>(
    `SELECT t.id, t.name, t.created_at, t.deleted_at, COUNT(a.id) AS artifacts
     FROM tokens t LEFT JOIN artifacts a ON a.token_id = t.id AND a.${LIVE_ARTIFACT_SQL}
     WHERE t.user_id = $1
     GROUP BY t.id, t.name, t.created_at, t.deleted_at
     ORDER BY t.created_at DESC`,
    [userId],
  );
  // COUNT comes back as a string on some drivers.
  return r.rows.map((row) => ({ ...row, artifacts: Number(row.artifacts) }));
}
