/**
 * A person's ARTIFACT LISTINGS: their profile root, what is shared to their address, a browser's
 * drafts, their dashboard list and their tokens with what each one published. Identity (lib/accounts)
 * knows who a person is; these read the artifact tables on that person's behalf.
 */
import type { ShareRole } from '@artifactbin/contracts/sharing';
// The trash gate (lib/artifacts LIVE_ARTIFACT_SQL) is a VALUE here rather
// than an inherited predicate: these listings build their own statements
// instead of going through the row-loading seam, so each one names the gate.
import { SUMMARY_META_FIELDS } from '@/lib/artifact-wire';
import { type ArtifactSummary } from '@/lib/artifacts';
import { LIVE_ARTIFACT_SQL } from '@/lib/artifact-access';

import { getDb } from '@/lib/platform';
import { viewTotalsFor } from '@/lib/analytics';

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

export async function listArtifactsByUser(userId: string): Promise<OwnedArtifactSummary[]> {
  return listOwnedArtifacts('user_id', userId);
}

/** Account dashboard rows or token attribution, with one aggregate of view totals. */
export async function listOwnedArtifacts(col: 'user_id' | 'token_id', value: string): Promise<OwnedArtifactSummary[]> {
  const db = await getDb();
  const r = await db.query<ArtifactSummary>(
    `SELECT ${summaryColumns('$2')} FROM artifacts WHERE group_id IS NULL AND ${col} = $1 AND ${LIVE_ARTIFACT_SQL} ORDER BY updated_at DESC LIMIT 200`,
    [value, META_ALLOWED],
  );
  return withViews(r.rows);
}
