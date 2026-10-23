/**
 * A person's ARTIFACT LISTINGS: their profile root, what is shared to their address, a browser's
 * drafts, their dashboard list and their tokens with what each one published. Identity (lib/accounts)
 * knows who a person is; these read the artifact tables on that person's behalf.
 */
import type { ShareRole } from '@artifactbin/contracts';
// The trash gate (lib/artifacts LIVE_ARTIFACT_SQL) is a VALUE here rather
// than an inherited predicate: these listings build their own statements
// instead of going through the row-loading seam, so each one names the gate.
import { SUMMARY_META_FIELDS, type ArtifactSummary } from '@/lib/artifacts';
import { LIVE_ARTIFACT_SQL } from '@/lib/artifacts/table';
import { LIVE_TOKEN_SQL } from '@/lib/accounts/tokens';
import { getDb } from '@/lib/platform/db';
import { viewTotalsFor } from '@/lib/platform';

const SUMMARY_COLS = ['id', 'title', 'description', 'format', 'version', 'visibility', 'ancestor_ids', 'created_at', 'updated_at'];
/** The one statement parameter every listing below binds for `meta`: which keys each format's summary shows. */
const META_ALLOWED = JSON.stringify(SUMMARY_META_FIELDS);

/**
 * The summary columns, `meta` narrowed IN SQL to the keys the summary wire shows for the row's format
 * (lib/artifacts SUMMARY_META_FIELDS, the table `artifactSummaryToWire` filters by too). A page of rows never
 * reads out, ships or parses a document's compiled CSS or object-store keys. `metaParam` is the placeholder
 * bound to META_ALLOWED; `alias` qualifies the columns when the statement joins.
 */
function summaryColumns(metaParam: string, alias = ''): string {
  const qualified = (column: string) => `${alias}${column}`;
  const meta = `COALESCE((SELECT jsonb_object_agg(m.key, m.value) FROM jsonb_each(${qualified('meta')}) m
         WHERE m.key IN (SELECT jsonb_array_elements_text(${metaParam}::jsonb -> ${qualified('format')}))), '{}'::jsonb) AS meta`;
  return `${SUMMARY_COLS.map(qualified).join(', ')}, ${meta}`;
}

/** Each row with its all-time unique daily visitors: ONE aggregate over the page's ids (view-totals), never a subquery per row. */
async function withViews(rows: ArtifactSummary[]): Promise<OwnedArtifactSummary[]> {
  const totals = await viewTotalsFor(rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, views: totals.get(row.id) ?? 0 }));
}

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
    `SELECT ${summaryColumns('$2')} FROM artifacts
     WHERE group_id IS NULL AND user_id = $1 AND visibility = 'public' AND format IN ('html', 'folder') AND ${LIVE_ARTIFACT_SQL}
       AND cardinality(ancestor_ids) = 0
     ORDER BY updated_at DESC LIMIT 200`,
    [userId, META_ALLOWED],
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
  const r = await db.query<SharedArtifactSummary>(
    `SELECT ${summaryColumns('$3', 'a.')}, u.username AS owner_username, s.role
     FROM artifacts a
     JOIN artifact_shares s ON s.artifact_id = a.id
     LEFT JOIN users u ON u.id = a.user_id
     WHERE s.email = $1 AND ($2::text IS NULL OR a.user_id IS DISTINCT FROM $2::text) AND a.${LIVE_ARTIFACT_SQL}
     ORDER BY a.updated_at DESC LIMIT 200`,
    [email.toLowerCase().trim(), excludeUserId ?? null, META_ALLOWED],
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
  const r = await db.query<ArtifactSummary>(
    `SELECT ${summaryColumns('$2', 'artifacts.')}
     FROM artifacts
     WHERE artifacts.group_id IS NULL AND artifacts.${LIVE_ARTIFACT_SQL} AND EXISTS (
       SELECT 1 FROM tokens LEFT JOIN users ON users.id = tokens.user_id
       WHERE tokens.id = ANY($1) AND ${LIVE_TOKEN_SQL}
         AND ((artifacts.user_id = tokens.user_id AND users.kind = 'guest')
           OR (artifacts.token_id = tokens.id AND artifacts.user_id IS NULL)))
     ORDER BY artifacts.updated_at DESC LIMIT 200`,
    [tokenIds, META_ALLOWED],
  );
  return withViews(r.rows);
}

export async function listArtifactsByUser(userId: string): Promise<OwnedArtifactSummary[]> {
  return listOwnedArtifacts('user_id', userId);
}

/**
 * The dashboard list for whichever credential the BROWSER holds: an account
 * (`user_id`) or an anonymous token (`token_id`, lib/agent-session). The same
 * two statements either way (the page, then its view counts as one aggregate over
 * the page's ids) — the view count is what makes this list different from
 * lib/artifacts' plain summary, and an anonymous owner's dashboard would look
 * broken without it.
 *
 * The column name comes from a two-value union, never from caller input.
 */
export async function listOwnedArtifacts(col: 'user_id' | 'token_id', value: string): Promise<OwnedArtifactSummary[]> {
  const db = await getDb();
  const r = await db.query<ArtifactSummary>(
    `SELECT ${summaryColumns('$2')} FROM artifacts WHERE group_id IS NULL AND ${col} = $1 AND ${LIVE_ARTIFACT_SQL} ORDER BY updated_at DESC LIMIT 200`,
    [value, META_ALLOWED],
  );
  return withViews(r.rows);
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
