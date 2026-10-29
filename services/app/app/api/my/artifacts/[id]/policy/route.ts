import { browserActor } from '@/lib/authentication';
import { datasetPolicyRequest } from '@/lib/document-data';
async function handle(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  return datasetPolicyRequest(request, actor, (await ctx.params).id);
}
export const GET = handle;
export const PUT = handle;
