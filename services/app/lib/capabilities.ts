/**
 * THE ONE CAPABILITY TABLE: `can(actor, capability, target?)`.
 *
 * Every door that used to ask "does this request have a userId" asks this
 * instead. That question was the defect: it said yes to an anonymous GUEST and
 * to the throwaway second person a session minted, so both could like, follow,
 * comment, fork and write `$_me` rows into a real account's datasets — residue
 * in someone else's data that nothing could take back out.
 *
 * Rows are KINDS (`users.kind`, lib/user-kinds), columns are capabilities
 * (`Capability` in contracts), and the cell depends on the TARGET:
 *
 *   ACCOUNT   — everything, everywhere. Its ROLE on a particular document is a
 *               separate question, asked where it always was (effectiveRole,
 *               canWriteDataset); this decides only what the KIND allows.
 *   GUEST     — read what the link grants, and create (an anonymous save,
 *               claimed at login). Nothing else: no like, follow, comment,
 *               fork, share or `$_me` write. Those doors send it to sign in.
 *   TESTUSER  — a FULL user inside the sandbox (an artifact a test user owns)
 *               and exactly a guest outside it. Its read of a real artifact is
 *               link-readership: it holds an address, never a share, and it has
 *               no email for a share to be addressed to.
 *   ANONYMOUS — read, and (holding a token) create its own drafts.
 *
 * The one door from the real world into the sandbox is an account FORKING one
 * of its readable artifacts `as` one of its test users, which is what the
 * `sandbox_only` refusal below names.
 */
import type { Capability } from '@artifactbin/contracts';
import { json } from './http';
import { canRead, canEdit } from './share-roles';
import { effectiveRole, getArtifactById, ownsArtifact, type ArtifactRow } from './artifacts';
import { userKindOf } from './user-kinds';

/** Who is acting: the ids a request already carries, nothing more. */
export interface CapabilityActor {
  userId: string | null;
  tokenId: string | null;
}

/** A user target (follow) rather than a document one. */
export interface UserTarget { userId: string }

export type CapabilityTarget = ArtifactRow | UserTarget;

const isArtifact = (target: CapabilityTarget): target is ArtifactRow => 'id' in target && 'visibility' in target;

/**
 * What the actor IS, for this decision. `none` is an unauthenticated request or
 * a bare anonymous token; a `userId` with no row at all reads as an account,
 * which is the polarity the retired `is_guest` flag had — the product does not
 * produce such an id, and inventing a refusal for it would be a silent change.
 */
type ActorKind = 'none' | 'account' | 'guest' | 'testuser';

async function kindOfActor(actor: CapabilityActor): Promise<ActorKind> {
  if (!actor.userId) return 'none';
  return (await userKindOf(actor.userId)) ?? 'account';
}

/** Is this artifact INSIDE the sandbox — owned by a test user? */
async function isSandboxArtifact(row: ArtifactRow): Promise<boolean> {
  return (await userKindOf(row.user_id)) === 'testuser';
}

/**
 * May this actor do this, to this?
 *
 * `target` is the artifact for every document capability, `{userId}` for
 * `follow`, and absent for `create`. A capability that needs a target and is
 * given none is `false`: a door that cannot say what it is acting on has not
 * asked a question this table can answer.
 */
export async function can(actor: CapabilityActor, capability: Capability, target?: CapabilityTarget): Promise<boolean> {
  const kind = await kindOfActor(actor);

  // An anonymous browser creates drafts and claims them at login; a guest is
  // that same person after the first save. Neither is a second identity.
  if (capability === 'create') return !!(actor.userId || actor.tokenId);

  if (!target) return false;

  if (capability === 'follow') {
    if (isArtifact(target)) return false;
    if (kind === 'account') return true;
    // A test user is a full person toward the other people in the sandbox.
    if (kind === 'testuser') return (await userKindOf(target.userId)) === 'testuser';
    return false;
  }

  if (!isArtifact(target)) return false;

  // READ is the link's own question, and `effectiveRole` already answers it for
  // every kind: a guest and a test user are held at the anonymous ceiling
  // outside the sandbox, and a share can never name either of them because
  // neither has an address. One definition of readability, not two.
  if (capability === 'read') return canRead(await effectiveRole(target, actor));

  // The owner of a draft may always work on it — including the anonymous token
  // that created it, which has no account to be judged by.
  if (ownsArtifact(target, actor)) return true;

  // An ANONYMOUS TOKEN owns drafts — that is what `create` says — so it may own
  // a FORK too, and the browser door's own "a fork needs an owner" refusal is
  // what decides the cookie case. Everything else needs a person to attribute
  // the act to, which a token is not.
  if (kind === 'none') return capability === 'fork' && !!actor.tokenId;
  if (kind === 'guest') return false;
  if (kind === 'testuser' && !(await isSandboxArtifact(target))) return false;

  // Inside the sandbox, and for an account anywhere: the KIND allows it. What
  // this actor's ROLE on this document allows is the caller's own next question.
  return capability === 'edit' ? canEdit(await effectiveRole(target, actor)) : true;
}

/** The machine-readable halves of the two refusals a capability check produces. */
export const SIGN_IN_REQUIRED_ERROR = 'sign_in_required';
export const SANDBOX_ONLY_ERROR = 'sandbox_only';

export interface CapabilityRefusal { status: number; body: { error: string; hint?: string; message?: string } }

/**
 * WHAT TO SAY when `can` said no. Two audiences, two answers:
 *
 *  - a guest or an anonymous request is one click from being allowed, so it
 *    gets the DOOR (`sign_in_required`, the code every control already knows
 *    how to turn into `/login?callbackUrl=…` — lib/story/sign-in-required);
 *  - a test user is refused for good, and the fix is to bring the artifact INTO
 *    the sandbox, so the hint names the command that does it.
 *
 * `capability` is not in the message on purpose: the caller's own route says
 * what was being attempted, and a refusal that repeats it reads as a lecture.
 */
export async function refusalFor(actor: CapabilityActor, artifactId?: string): Promise<CapabilityRefusal> {
  if ((await kindOfActor(actor)) === 'testuser') {
    const target = artifactId ?? '<id>';
    return {
      status: 403,
      body: {
        error: SANDBOX_ONLY_ERROR,
        hint: `a test user acts only inside its sandbox. Bring this artifact in first: afbin fork ${target} --as <testuser>, then act on the copy`,
      },
    };
  }
  return { status: 401, body: { error: SIGN_IN_REQUIRED_ERROR } };
}

/** The refusal as a Response, for the routes that answer one directly. */
export async function capabilityRefusal(actor: CapabilityActor, artifactId?: string): Promise<Response> {
  const refusal = await refusalFor(actor, artifactId);
  return json(refusal.body, refusal.status);
}

/**
 * THE ROUTE-LEVEL GATE, for the doors that hold an id rather than a row: the
 * refusal to answer, or null to carry on.
 *
 * An id this actor cannot READ answers `null` on purpose — including one that
 * names nothing. "Does it exist" is the caller's own question and its own
 * uniform 404, and a capability refusal must never become the door that tells a
 * stranger an id is real: the gate speaks only to someone the artifact is
 * already visible to.
 */
export async function capabilityGuard(actor: CapabilityActor, capability: Capability, artifactId: string): Promise<Response | null> {
  const row = await getArtifactById(artifactId);
  if (!row || !(await can(actor, 'read', row))) return null;
  return (await can(actor, capability, row)) ? null : capabilityRefusal(actor, artifactId);
}
