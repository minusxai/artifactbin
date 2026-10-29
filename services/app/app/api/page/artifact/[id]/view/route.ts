import { recordArtifactView } from '@/lib/artifact-wire';
import { sessionActor } from '@/lib/authentication';
import { json } from '@/lib/http';

/** The inline browser reader reports an open independently of page-data reads. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const result = await recordArtifactView(request, (await ctx.params).id, () => sessionActor(request));
  if (result === 'not_found') return json({ error: result }, 404);
  if (result === 'forbidden') return json({ error: result }, 403);
  return new Response(null, { status: 204 });
}
