import { browserActor } from '@/lib/auth';
import { actorForArtifacts } from '@/lib/viewer';
import { unauthorized } from '@/lib/http';
import { datasetPolicyRequest } from '@/lib/datasets/policy/http';
async function handle(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await browserActor(request);
  if (auth instanceof Response) return auth;
  const actor = actorForArtifacts(auth);
  if (!actor) return unauthorized(request);
  return datasetPolicyRequest(request, actor, (await ctx.params).id);
}
export const GET = handle;
export const PUT = handle;
