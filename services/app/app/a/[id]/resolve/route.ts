import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { ID_RE } from '@/lib/ids';
import { serveStoredFile } from '@/lib/story/file-store';

/**
 * Anonymous byte access, scoped by path so each document's CSP stays narrow.
 * The containing id is only a transport namespace: it grants no access to any
 * document or asset. Cookies, bearer tokens and document export keys never
 * grant private asset access here. Both HEAD and GET recheck visibility.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const ref = new URL(request.url).searchParams.get('ref') ?? '';
  const target = ref.startsWith('ref:') ? ref.slice(4) : '';
  const missing = () => new Response('not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
  if (!ID_RE.test(id) || !ID_RE.test(target)) return missing();
  const row = await getArtifactById(target);
  if (!row || !['file', 'image', 'pdf'].includes(row.format) || !(await canReadArtifact(row, null))) return missing();
  return serveStoredFile(request, row, true);
}
export const HEAD = GET;
