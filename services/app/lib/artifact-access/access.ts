/**
 * THE ACCESS RULE IN JAVASCRIPT: ownership, the role lattice and the host's document-editor grant, decided from a row
 * and the facts (./access-facts). `./scopes` is the same rule in SQL; lib/artifacts `canReadArtifact` is the one
 * read decision every serving path makes with it.
 */
import type { AccessActor } from '@/lib/accounts';
import { isLinkOnlyKind } from '@/lib/user-kinds';
import { liveAccessFacts, type AccessFacts } from './access-facts';
import type { ArtifactRow } from './scopes';
import { ANONYMOUS_CEILING, capRole, maxRole, type ArtifactRole } from '@artifactbin/contracts';

/** Does this actor OWN the row — pure, the account by user_id, a bare token by token_id. */
export function ownsArtifact(row: Pick<ArtifactRow, 'user_id' | 'token_id'> & Partial<Pick<ArtifactRow,'group_id'>>, actor: AccessActor): boolean {
  if (row.group_id) return !!actor.groupId && actor.groupId===row.group_id;
  if (row.user_id) return !!actor.userId && row.user_id === actor.userId;
  return holdsCreatingToken(row, actor);
}

/** Does this actor hold the token that created the row? A null token never matches: anonymous and browser
 * actors carry `tokenId: null`, and so can rows (imported or account-anchored), so a bare equality admits them. */
export function holdsCreatingToken(row: Pick<ArtifactRow, 'token_id'>, actor: Pick<AccessActor, 'tokenId'>): boolean {
  return !!actor.tokenId && row.token_id === actor.tokenId;
}


/**
 * The role this actor holds WITHOUT the link — ownership, or a share naming
 * them personally. The other half of `effectiveRole`, and it is separate
 * because one question in the product needs it alone: a LISTING.
 *
 * `unlisted` means "reads like public, listed nowhere", so a listing may not
 * be built from "may this viewer read it" — the link is exactly what an
 * unlisted row grants and exactly what a listing must not honour
 * (lib/folders childrenTableFor). Holding the address is not a relationship
 * to the row; ownership and an invitation are.
 *
 * Ownership short-circuits, so the share lookup is a query the owner's every
 * request would otherwise pay for.
 */
export async function roleWithoutLink(
  row: Pick<ArtifactRow, 'id' | 'user_id' | 'token_id'> & Partial<Pick<ArtifactRow,'format'|'group_id'>>,
  actor: AccessActor,
  facts: AccessFacts = liveAccessFacts(actor),
): Promise<ArtifactRole> {
  if (ownsArtifact(row, actor)) return 'owner';
  let groupRole:ArtifactRole='none';
  if (row.group_id) {
    const role = await facts.groupRole(row.group_id);
    if(role==='editor')return 'owner';
    if(role==='viewer')groupRole='viewer';
  }
  // A NAMED share can never reach a guest or a test user: neither has an email
  // for an invitation to be addressed to, and neither is the kind of identity
  // an account invites. They reach a stranger's document through the LINK or
  // not at all (lib/user-kinds).
  if (isLinkOnlyKind(await facts.userKind(actor.userId))) return groupRole;
  return maxRole(groupRole,await namedRoleFor(row, actor, facts));
}

/**
 * THE ONE ACCESS DECISION — what this actor may do with this row, as a single
 * value on the lattice (@artifactbin/contracts sharing). Read-access is `canRead` of it, the
 * page chrome is `canEdit`/`canAnnotate` of it, and the reader/owner serving
 * split is a comparison against it.
 *
 * It is the MAX of the three independent ways a role can arrive:
 *   - ownership       — the account, or the bare token that created it;
 *   - a named share   — artifact_shares, by resolved user id or unresolved email;
 *   - the LINK        — what a stranger holding the address gets.
 *
 * `facts` is where the decision reads groups, kinds and shares (lib/artifact-access access facts): the
 * database, one lookup at a time, unless a caller deciding many rows preloaded them.
 */
export async function effectiveRole(
  row: Pick<ArtifactRow, 'id' | 'user_id' | 'token_id' | 'visibility' | 'link_role'> & Partial<Pick<ArtifactRow,'format'|'group_id'>>,
  actor: AccessActor,
  facts: AccessFacts = liveAccessFacts(actor),
): Promise<ArtifactRole> {
  const held = await roleWithoutLink(row, actor, facts);
  if (held === 'owner') return 'owner';
  // THE ANONYMOUS CEILING applies to the LINK only, never to a named share:
  // being invited by address is itself an account-shaped act, while holding a
  // URL is not. Without an account there is nothing to attribute a write to.
  const account = !!actor.userId && await reachesAsAccount(row, actor, facts);
  const byLink = account ? linkRoleOf(row) : capRole(linkRoleOf(row), ANONYMOUS_CEILING);
  return maxRole(byLink, account && documentEditorReaches(row, actor) ? 'editor' : 'none', held);
}

/**
 * Does the LINK grant this actor its full role, or only the anonymous ceiling?
 *
 * An ACCOUNT: yes. A guest: never — holding a URL is not an account-shaped act.
 * A TEST USER: only inside the sandbox, toward an artifact another test user
 * owns, which is what makes it a full user in there and a guest out here
 * (lib/user-kinds, the same rule the SQL scopes read).
 */
async function reachesAsAccount(row: Pick<ArtifactRow, 'user_id'>, actor: AccessActor, facts: AccessFacts): Promise<boolean> {
  const kind = await facts.userKind(actor.userId);
  if (kind === null || kind === 'account') return true;
  if (kind !== 'testuser') return false;
  return await facts.userKind(row.user_id) === 'testuser';
}

/**
 * THE HOST'S DOCUMENT-EDITOR GRANT (production: ADMIN__EMAILS), decided once per request by the resolver
 * (`actor.documentEditor`) and applied HERE and in the SQL scopes (./scopes `scopeAtLeast`) by
 * one rule: it reaches exactly what a link could reach — a page document that is not private — and makes
 * the holder its editor. Never a private artifact of any kind, never a dataset, never ownership (delete,
 * sharing). Like the link, it lists nothing: a listing reads `roleWithoutLink`, which this is not part of.
 */
export function documentEditorReaches(row: Partial<Pick<ArtifactRow, 'format' | 'visibility'>>, actor: Pick<AccessActor, 'documentEditor'>): boolean {
  return actor.documentEditor && (row.format === 'markup' || row.format === 'html') && row.visibility !== undefined && row.visibility !== 'private';
}

/**
 * What the LINK alone grants — everyone who holds the address and nothing else.
 *
 * TWO independent facts, and `visibility` gates the column above it: visibility
 * answers REACH (may the address get you in at all), `link_role` answers what
 * you may DO once it has. So a `private` document grants nothing no matter what
 * the column holds — which is what lets the setting be REMEMBERED across a trip
 * through `private` rather than silently reset.
 *
 * NULL reads as `viewer`.
 */
export function linkRoleOf(row: Pick<ArtifactRow, 'visibility' | 'link_role'>): ArtifactRole {
  if (row.visibility === 'private') return 'none';
  return row.link_role ?? 'viewer';
}

/**
 * What the SHARE LIST grants this actor. An anonymous token has no address and
 * no account, so it can never be named — it returns `none` without a query.
 *
 * The predicate is the union of the two the old pair used: a share matches by
 * its RESOLVED user id first, and by email only while still unresolved —
 * either the address this session carries, or the account's own, so an agent
 * arriving with a token (and therefore no session address) still reaches what
 * its person was invited to.
 */
async function namedRoleFor(
  row: Pick<ArtifactRow, 'id'>,
  actor: AccessActor,
  facts: AccessFacts,
): Promise<ArtifactRole> {
  if (!actor.userId) return 'none';
  return facts.namedRole(row.id);
}
