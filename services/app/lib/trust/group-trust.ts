/**
 * WHAT A GROUP HAS APPROVED for its members: the second level of document trust (./document-trust has the first, one
 * reader on one page). A group's editor approves an exact origin under a directive that calls or loads data
 * (lib/document `GROUP_CSP_DIRECTIVES`: connect, img, media), and from the next response every member of the group, and
 * of each of its subgroups (lib/groups `reachedGroupsSql`: a reader reaches their direct groups and every ancestor), is
 * not asked about it on ANY page that declares it. Nobody outside the group is, whoever owns the page.
 *
 *  - Script, style and frame run or embed code: never a group's to grant. A wildcard declaration is never approvable,
 *    and an approval is the canonical exact origin a declaration normalises to (lib/document `parseCspOrigin`).
 *  - Who: a direct editor of the group (`GroupRole` has editor and viewer; editors administer). Any direct member reads
 *    the list. Every change is audited on the group (lib/groups `recordGroupMutation`) in its own transaction.
 *  - A reader's own Never on a document still wins there (./document-trust `standingOf`).
 *  - TRUST__GROUP_APPROVALS=off: nothing is offered, the API refuses, and stored rows are ignored (never deleted).
 *  - A deleted group's rows stay and grant nothing: every read joins live groups only.
 */
import { getDb, groupTrustApprovalsEnabled } from '@/lib/platform';
import { getGroupRole, reachedGroupsSql, recordGroupMutation } from '@/lib/groups';
import {
  CSP_DIRECTIVES, GROUP_CSP_DIRECTIVES, emptyCspExtensions, groupEligibleCspExtensions, hasCspExtensions, parseCspOrigin,
  type CspApprovalGroup, type CspDirective, type CspExtensions,
} from '@/lib/document';

/** A refusal with a stable code, an HTTP status and a sentence saying what to change. */
export class TrustError extends Error {
  constructor(public code: string, public status: number, public detail?: string) { super(code); }
}

/** One approved address as the group's settings show it. */
export interface GroupTrustedAddress {
  directive: CspDirective;
  host: string;
  approved_by: { id: string; username: string | null; name: string | null };
  approved_at: string;
}

/** Most addresses one group may hold, and one request may name: the list stays a list a person reads. */
const MAX_GROUP_ADDRESSES = 200;
const MAX_ADDRESSES_PER_REQUEST = 30;

function requireEnabled(): void {
  if (!groupTrustApprovalsEnabled()) throw new TrustError('group_approvals_disabled', 403, 'This installation does not allow group approvals (TRUST__GROUP_APPROVALS=off).');
}

/**
 * A request body (`{ connect?: [...], img?: [...], media?: [...] }`) → the canonical set, or why it is refused: an
 * ineligible directive (script, style, frame), a wildcard, an origin the declaration grammar refuses, or nothing at all.
 */
export function parseGroupAddresses(body: unknown): CspExtensions {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TrustError('invalid_addresses', 400, 'Send { "connect": [...], "img": [...], "media": [...] } with https origins.');
  const out = emptyCspExtensions();
  let count = 0;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!CSP_DIRECTIVES.includes(key as CspDirective)) continue;
    const directive = key as CspDirective;
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new TrustError('invalid_addresses', 400, `${directive} must be a list of https origins.`);
    if (!value.length) continue;
    if (!GROUP_CSP_DIRECTIVES.includes(directive)) {
      throw new TrustError('directive_not_allowed', 400, `A group may approve only ${GROUP_CSP_DIRECTIVES.join(', ')} addresses; ${directive} runs or embeds code and needs a per-page answer.`);
    }
    for (const written of value as string[]) {
      const parsed = parseCspOrigin(written.trim());
      if (!parsed.ok) throw new TrustError('invalid_address', 400, `"${written}" ${parsed.reason}.`);
      if (parsed.origin.includes('*')) throw new TrustError('wildcard_not_allowed', 400, `"${written}" is a wildcard; a group approves exact origins only.`);
      if (!out[directive].includes(parsed.origin)) { out[directive].push(parsed.origin); count++; }
    }
  }
  if (!hasCspExtensions(out)) throw new TrustError('invalid_addresses', 400, 'Name at least one https origin under connect, img or media.');
  if (count > MAX_ADDRESSES_PER_REQUEST) throw new TrustError('too_many_addresses', 400, `Name at most ${MAX_ADDRESSES_PER_REQUEST} addresses at once.`);
  return out;
}

const pairsOf = (set: CspExtensions): Array<[CspDirective, string]> => GROUP_CSP_DIRECTIVES.flatMap((d) => set[d].map((host): [CspDirective, string] => [d, host]));

/** A group's approved addresses, for any direct member (not a member, or a deleted group: not_found). */
export async function listGroupAddresses(userId: string, groupId: string): Promise<GroupTrustedAddress[]> {
  requireEnabled();
  const db = await getDb();
  if (!(await getGroupRole(userId, groupId, db))) throw new TrustError('not_found', 404);
  const rows = (await db.query<{ directive: CspDirective; host: string; created_by: string; created_at: string | Date; username: string | null; name: string | null }>(
    `SELECT t.directive, t.host, t.created_by, t.created_at, u.username, u.name FROM group_trust t LEFT JOIN users u ON u.id = t.created_by
     WHERE t.group_id = $1 ORDER BY t.host, t.directive LIMIT ${MAX_GROUP_ADDRESSES}`, [groupId])).rows;
  return rows.map((row) => ({
    directive: row.directive, host: row.host,
    approved_by: { id: row.created_by, username: row.username, name: row.name },
    approved_at: new Date(row.created_at).toISOString(),
  }));
}

/** Approve (`present`) or remove addresses for a whole group: its direct editors only, audited on the group. */
export async function setGroupAddresses(userId: string, groupId: string, addresses: CspExtensions, present: boolean, actor?: { tokenId: string | null }): Promise<{ changed: CspExtensions }> {
  requireEnabled();
  const pairs = pairsOf(groupEligibleCspExtensions(addresses));
  const changed = emptyCspExtensions();
  await (await getDb()).transaction(async (tx) => {
    const role = await getGroupRole(userId, groupId, tx);
    if (!role) throw new TrustError('not_found', 404);
    if (role !== 'editor') throw new TrustError('forbidden', 403, 'Only an editor of this group may change what it approves.');
    for (const [directive, host] of pairs) {
      const done = present
        ? await tx.query('INSERT INTO group_trust (group_id, directive, host, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING host', [groupId, directive, host, userId])
        : await tx.query('DELETE FROM group_trust WHERE group_id = $1 AND directive = $2 AND host = $3 RETURNING host', [groupId, directive, host]);
      if (done.rows.length) changed[directive].push(host);
    }
    if (present && hasCspExtensions(changed)) {
      const held = Number((await tx.query<{ n: string | number }>('SELECT count(*) AS n FROM group_trust WHERE group_id = $1', [groupId])).rows[0]?.n ?? 0);
      if (held > MAX_GROUP_ADDRESSES) throw new TrustError('too_many_addresses', 409, `A group holds at most ${MAX_GROUP_ADDRESSES} addresses; remove some first.`);
    }
    if (hasCspExtensions(changed)) await recordGroupMutation(tx, userId, groupId, present ? 'addresses_allowed' : 'addresses_removed', { addresses: changed }, [], actor);
  });
  return { changed };
}

/**
 * Of `wanted` (a document's hosts this reader was not presumed to consent to), what a group this reader reaches has
 * approved. ONE query, bounded by the wanted hosts; nothing when signed out, when the setting is off, or when `wanted`
 * holds nothing a group could approve. Called by the serving hook outside any transaction.
 */
export async function groupApprovedFor(userId: string | null | undefined, wanted: CspExtensions): Promise<CspExtensions> {
  const out = emptyCspExtensions();
  const pairs = pairsOf(groupEligibleCspExtensions(wanted));
  if (!userId || !pairs.length || !groupTrustApprovalsEnabled()) return out;
  const rows = (await (await getDb()).query<{ directive: CspDirective; host: string }>(
    `SELECT DISTINCT t.directive, t.host FROM group_trust t
     WHERE t.group_id IN (${reachedGroupsSql('$1')}) AND t.directive = ANY($2::text[]) AND t.host = ANY($3::text[])`,
    [userId, [...new Set(pairs.map(([d]) => d))], [...new Set(pairs.map(([, h]) => h))]])).rows;
  for (const [directive, host] of pairs) if (rows.some((row) => row.directive === directive && row.host === host)) out[directive].push(host);
  return out;
}

/** The live groups this reader may approve for (those they directly edit), when approvals are on. */
export async function approvableGroupsFor(userId: string | null | undefined): Promise<CspApprovalGroup[]> {
  if (!userId || !groupTrustApprovalsEnabled()) return [];
  return (await (await getDb()).query<CspApprovalGroup>(
    "SELECT g.id, g.handle, g.name FROM group_members m JOIN groups g ON g.id = m.group_id WHERE m.user_id = $1 AND m.role = 'editor' AND g.deleted_at IS NULL ORDER BY g.name, g.id LIMIT 20",
    [userId])).rows;
}
