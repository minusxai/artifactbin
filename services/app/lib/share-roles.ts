/**
 * The share vocabulary — PURE, so a client component (the share menu) and the
 * server (lib/artifacts, the sharing route) speak the same words without the
 * client pulling the database graph in behind a single constant. A `'use
 * client'` file may import VALUES from here and only types from lib/artifacts
 * (lib/__tests__/client-import-hygiene.test.ts).
 *
 * What a NAMED person on an artifact may do (artifact_shares.role) — the
 * sibling of `visibility`, and orthogonal to it: visibility is who may read
 * via the LINK, a share is a person by email and their role, under every
 * visibility. That is what lets a public document have editors at all.
 *   'viewer' — may read it when private (every share that predates roles).
 *   'commenter' — may also annotate: open threads, reply, resolve. Never edit.
 *   'editor' — may also edit, PUT, revert and read history (and annotate).
 *              Never delete, share, move or open writes: those stay the owner's.
 */
export type ShareRole = 'viewer' | 'commenter' | 'editor';
export const SHARE_ROLES: readonly ShareRole[] = ['viewer', 'commenter', 'editor'];
export interface ShareEntry {
  email: string;
  role: ShareRole;
}
/** How the share menu names each role. */
export const SHARE_ROLE_LABEL: Record<ShareRole, string> = { viewer: 'can view', commenter: 'can comment', editor: 'can edit' };

/**
 * This actor's relationship to one artifact — the ONE role decision
 * (lib/artifacts effectiveRole), consulted by the reader/owner split, the page
 * chrome and every SQL scope.
 *
 * `none` is the miss: not "may read but may do nothing", but "may not read at
 * all", which every serving path answers as the uniform 404. It replaced
 * `reader`, a value that meant BOTH "a named viewer" and "a stranger who
 * followed the link" — read-access was decided by one function and role by
 * another, and the two disagreed about what a share was and about how a person
 * matched one. One ordered vocabulary is what removes that seam.
 */
export type ArtifactRole = 'none' | ShareRole | 'owner';

/**
 * THE LATTICE, ascending — the whole access model in one line. Every role
 * question is a comparison on it, and a role is composed by taking the HIGHEST
 * of the ways you could have got one (ownership, a named share, the link):
 * `max` is deliberate, so a share can only ever RAISE what the link already
 * grants and never lower it. Expressing a downgrade would take a second
 * lattice, which is worse than the thing it would fix.
 */
export const ROLE_ORDER: readonly ArtifactRole[] = ['none', 'viewer', 'commenter', 'editor', 'owner'];

/** Where a role sits on the lattice. An unknown value ranks as `none` — fail closed. */
export const rankOf = (role: ArtifactRole): number => Math.max(0, ROLE_ORDER.indexOf(role));

/** The highest of the roles offered. No arguments (nothing grants) is `none`. */
export const maxRole = (...roles: ArtifactRole[]): ArtifactRole =>
  roles.reduce<ArtifactRole>((best, r) => (rankOf(r) > rankOf(best) ? r : best), 'none');

/** Does this role reach `min` on the lattice? */
export const atLeast = (role: ArtifactRole, min: ArtifactRole): boolean => rankOf(role) >= rankOf(min);

/** `role`, held down to `ceiling` — the shape of every rule that says "no more than this". */
export const capRole = (role: ArtifactRole, ceiling: ArtifactRole): ArtifactRole =>
  (rankOf(role) > rankOf(ceiling) ? ceiling : role);

/**
 * THE ANONYMOUS CEILING. Someone holding only the address and no account may
 * READ and nothing else, whatever the link is set to.
 *
 * It is one rule standing in for two carve-outs that would otherwise each need
 * arguing (may a stranger comment? may a link grant edit?), and it rests on an
 * invariant the product already has: every write is ATTRIBUTED — actor_user_id
 * on the head, the edit log and the archived version; `by` in the history and
 * the live frame; an author label snapshot on every comment. A write with
 * nobody behind it has no place to record.
 *
 * It pays for itself twice: because anonymous never rises above `viewer`, the
 * crawler and the logged-out reader keep the direct-document fast path
 * (server/app servesDocumentDirectly) even on a link-commentable document.
 *
 * An anonymous TOKEN is not an account: it can be attributed to a token, but it
 * has no handle to show beside a comment, so it sits under the ceiling too.
 */
export const ANONYMOUS_CEILING: ArtifactRole = 'viewer';

/**
 * What signing in would UNLOCK for whoever holds this link — the link's own
 * role when the ceiling is the only thing withholding it, else `none`.
 *
 * The exact inverse of the cap in effectiveRole, and it lives here so the two
 * cannot drift: the ceiling is what makes the refusal correct, and this is what
 * keeps it from being SILENT. An owner who sets a link to `can comment` has
 * invited whoever holds it; a guest who is shown nothing has been invited and
 * not told. The served document names it and offers /login (lib/story/document
 * renderReaderChrome) — a door, never a capability. Nothing about who may
 * actually write changes until there is an account for a share to resolve to.
 *
 * `none` at or below the ceiling is the load-bearing half: a guest already
 * READS a public document, so a login offer there would be chrome with no
 * consequence on every public link in the product.
 */
export const roleBehindLogin = (linkRole: ArtifactRole): ArtifactRole =>
  (rankOf(linkRole) > rankOf(ANONYMOUS_CEILING) ? linkRole : 'none');

/**
 * The four capability questions, answered in ONE place so the server door and
 * the UI hook that offers the control cannot drift apart.
 *
 *  - canRead     — anything at all; below it is the uniform 404.
 *  - canAnnotate — open threads, reply, resolve. Says something, changes nothing.
 *  - canEdit     — in-place edits, PUT, revert, history, the agent prompt.
 *  - canGovern   — access, shares, folder, delete, dataset write ACL. The owner alone.
 */
export const canRead = (role: ArtifactRole): boolean => atLeast(role, 'viewer');
export const canAnnotate = (role: ArtifactRole): boolean => atLeast(role, 'commenter');
export const canEdit = (role: ArtifactRole): boolean => atLeast(role, 'editor');
export const canGovern = (role: ArtifactRole): boolean => role === 'owner';

/** The share roles that reach `min` — the role list a scoped SQL predicate names. */
export const shareRolesAtLeast = (min: ArtifactRole): readonly ShareRole[] =>
  SHARE_ROLES.filter((r) => atLeast(r, min));
