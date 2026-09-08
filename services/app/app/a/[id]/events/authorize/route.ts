/**
 * May this caller follow this document, and on which channels? The answer a
 * RELAY asks for before it subscribes (blind to content, it cannot run the
 * ACL itself): the document's own channel plus every dataset it reads or
 * writes — re-derived per version, since a document that starts reading a
 * dataset must be subscribed by the time its reader can see the query.
 * Each dataset channel is paired with the id the document names (channels are
 * lowercased, ids are not), and the annotations channel is granted beside them.
 */
import { canReadArtifact, datasetsForDocument, getArtifactById } from '@/lib/artifacts';
import { ID_RE } from '@/lib/ids';
import { channelFor, channelForAnnotations } from '@/lib/story/live';
import { sessionActor } from '@/lib/viewer';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return new Response('not found', { status: 404 });
  const row = await getArtifactById(id);
  if (!row) return new Response('not found', { status: 404 });
  const actor = await sessionActor(request);
  if (!(await canReadArtifact(row, actor.viewer))) return new Response('not found', { status: 404 });
  const datasets = row.format === 'markup' ? datasetsForDocument(row.source) : [];
  return Response.json(
    {
      editId: row.edit_id,
      version: row.version,
      channels: [channelFor(row.id), ...datasets.map(channelFor)],
      datasets: Object.fromEntries(datasets.map((d) => [channelFor(d), d])),
      annotations: channelForAnnotations(row.id),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
