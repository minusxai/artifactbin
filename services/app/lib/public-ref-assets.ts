import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { ID_RE } from '@/lib/ids';
import type { WebAssetKind } from '@/lib/web-assets';
import { serveStoredFile } from '@/lib/story/file-store';

/** A read grant, login, token, or export key never widens a referenced file. */
export async function publicRefAsset(id: string, kind: WebAssetKind | 'binary' = 'binary') {
  if (!ID_RE.test(id)) return null;
  const row = await getArtifactById(id);
  if (!row || !['file', 'image', 'pdf'].includes(row.format) || !await canReadArtifact(row, null)) return null;
  const type = (row.meta as { contentType?: string })?.contentType ?? 'application/octet-stream';
  if (kind !== 'binary' && !(kind === 'image' ? type.startsWith('image/') : kind === 'font' ? type.startsWith('font/')
    : kind === 'pdf' ? type === 'application/pdf' : ['text/javascript', 'application/javascript'].includes(type))) return null;
  return row;
}

/** Dedicated-host response; identity-addressed refs must always re-check visibility. */
export async function publicRefAssetResponse(request: Request, id: string): Promise<Response> {
  const row = await publicRefAsset(id);
  if (!row) return new Response('not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
  return serveStoredFile(request, row, true);
}
