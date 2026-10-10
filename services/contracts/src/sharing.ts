/**
 * The share vocabulary — PURE, so the UI (the share menu, the page chrome) and
 * the server (lib/artifacts, the sharing route) speak the same words without the
 * browser pulling the database graph in behind a single constant: the role
 * lattice, the read ACL (`Visibility`), the dataset write ACL (`DatasetAccess`)
 * and what the sharing surface may change (`SharingPatch`).
 *
 * What a NAMED person on an artifact may do (artifact_shares.role) — the
 * sibling of `visibility`, and orthogonal to it: visibility is who may read
 * via the LINK, a share is a person by email and their role, under every
 * visibility. That is what lets a public document have editors at all.
 *   'viewer' — may read it when private.
 *   'commenter' — may also annotate: open threads, reply, resolve. Never edit.
 *   'editor' — may also edit, PUT, revert and read history (and annotate).
 *              May manage sharing and dataset data actions. Deletion and restoration stay the owner's.
 */
export const SHARE_ROLES = ['viewer','commenter','editor'] as const;
export type ShareRole = typeof SHARE_ROLES[number];
export interface ShareEntry {email:string;role:ShareRole}

/**
 * The read ACL. 'public' = anyone with the link may read, and owned docs list
 * on the owner's profile root (/@handle);
 * 'unlisted' = reads exactly like public but never lists anywhere;
 * 'private' = the owner plus the emails in artifact_shares. Defaults at create
 * (createArtifact): anonymous → 'public', or 'unlisted' where the deployment
 * has not opened public; user-owned → 'unlisted' for image/dataset/pdf/file
 * and 'private' otherwise.
 */
export type Visibility = 'public' | 'private' | 'unlisted';

/**
 * The WRITE ACL, on DATASETS only — the sibling of `visibility`, and the
 * whole toggle behind writable data:
 *   'read'      — the default and every dataset that predates this. Documents
 *                 may only SELECT from it; a `<Mutation>` naming it is refused
 *                 at publish, and at every call besides.
 *   'readwrite' — documents the dataset's OWNER publishes may insert, update
 *                 and delete rows through a declared `<Mutation>`, for
 *                 everyone who can read those documents.
 * Two separate questions, deliberately: `visibility` is who may READ the
 * artifact itself, this is who may CHANGE it through a document. Neither
 * implies the other — a public dataset stays read-only unless its owner says
 * otherwise, and an unlisted one can be the writable table behind a poll.
 */
export type DatasetAccess = 'read' | 'readwrite';
export const DATASET_ACCESS: readonly DatasetAccess[] = ['read', 'readwrite'];

/** How the share menu names each role. */
export const SHARE_ROLE_LABEL: Record<ShareRole, string> = { viewer: 'can view', commenter: 'can comment', editor: 'can edit' };

/**
 * This actor's relationship to one artifact — the ONE role decision
 * (lib/artifacts effectiveRole), consulted by the reader/owner split, the page
 * chrome and every SQL scope.
 *
 * `none` is the miss: not "may read but may do nothing", but "may not read at
 * all", which every serving path answers as the uniform 404. One ordered
 * vocabulary decides read-access and role together, so the two cannot disagree
 * about what a share is or about how a person matches one.
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
 * An anonymous TOKEN is not an account: it can be attributed to a token, but it
 * has no handle to show beside a comment, so it sits under the ceiling too.
 */
export const ANONYMOUS_CEILING: ArtifactRole = 'viewer';

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

/** What the sharing surface may change, all optional — absent means untouched. */
export interface SharingPatch {
  visibility?: Visibility;
  shares?: ShareEntry[];
  access?: DatasetAccess;
  /** What the link grants. Stored even while `private`, where `linkRoleOf` ignores it — so flipping back to a link-readable tier restores the choice rather than silently resetting it. */
  linkRole?: ShareRole;
}
