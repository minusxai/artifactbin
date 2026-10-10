import { actorOf } from '@artifactbin/utils';
import { ANONYMOUS, canEdit } from '@artifactbin/contracts';
import { json, readJson } from '@/lib/http';
import { effectiveRole, getArtifactById } from '@/lib/artifacts';
import { mergeGuestUsers, claimTokenById } from '@/lib/accounts';
import { sessionActor } from '@/lib/accounts';

/** Auth-to-app seam. Reuse/create browser ownership, never copy artifact permissions. */
export async function POST(request: Request) {
  const body = await readJson(request);
  const actor = actorOf(request) ?? ANONYMOUS;
  if (body?.action === 'connect') {
    if (actor.credential === 'bearer') return json({ error: 'browser_required' }, 403);
    if (actor.credential === 'session' && actor.userId) {
      await sessionActor(request);
      if (actor.emailVerified) await mergeGuestUsers(actor.userId, actor.heldTokenIds ?? []);
      for (const id of actor.heldTokenIds ?? []) await claimTokenById(actor.userId, id);
      return json({ userId: actor.userId });
    }
    return json({ error: 'email_auth_required' }, 401);
  }
  if (typeof body?.artifactId !== 'string') return json({ error: 'invalid_artifact' }, 400);
  const row = await getArtifactById(body.artifactId);
  if (!row || row.format !== 'markup') return json({ error: 'not_found' }, 404);
  const allowed = await effectiveRole(row, { tokenId: actor.tokenId ?? null, userId: actor.userId ?? null });
  const browser = actor.credential === 'session';
  const canApprove = browser && ((!!actor.userId && actor.userId === row.user_id) || (!row.user_id && (actor.heldTokenIds ?? [actor.tokenId]).includes(row.token_id)));
  return json({ canEdit: canEdit(allowed), canApprove, ...(canApprove ? { title: row.title ?? 'Untitled' } : {}) });
}
