/**
 * The owner's supporting files, separate from the document shelf. The payload
 * includes folders solely as move-picker destinations; they are not rows in
 * the assets table.
 */
import { json, unauthorized } from '@/lib/http';
import { workspaceAssetsFor } from '@/lib/workspace-inventory';
import { sessionActor } from '@/lib/viewer';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  const userId = actor.credential === 'session' ? actor.viewer?.userId : null;
  if (!userId) return unauthorized(request);

  const params = new URL(request.url).searchParams;
  const rawPage = params.get('page') ?? '0';
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(Number(rawPage))) {
    return json({ error: 'invalid_page' }, 400, { 'Cache-Control': 'no-store' });
  }
  return json(await workspaceAssetsFor(userId, {
    page: Number(rawPage), query: params.get('q') ?? '',
    formats: params.getAll('formats'), visibilities: params.getAll('visibilities'),
  }), 200, { 'Cache-Control': 'no-store' });
}
