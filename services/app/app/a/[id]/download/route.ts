/**
 * The offline file: one self-contained `.html` a reader can open without a
 * network and pass on. Assembly and access live in lib/offline/assemble.server
 * (the same read rule as viewing); this door only answers in HTTP. A refusal
 * the caller may not learn about is the uniform 404 every read door gives.
 */
import { requestOrSessionActor } from '@/lib/viewer';
import { baseUrl, json } from '@/lib/http';
import { ID_RE } from '@/lib/ids';
import { assembleArtifactFile } from '@/lib/offline/assemble.server';
import { offlineBundle } from '@/lib/offline/bundle.server';
import { renderArtifactFileHtml } from '@/lib/offline/file-html';

/** A filename every OS accepts, from the document's title. */
const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'artifact'}.html`;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404);
  const actor = await requestOrSessionActor(request);
  const asked = new URL(request.url).searchParams.get('version');
  const version = asked && /^\d+$/.test(asked) ? Number(asked) : undefined;
  const file = await assembleArtifactFile({
    id,
    actor: { ...actor.viewer, userId: actor.viewer?.userId ?? null, tokenId: actor.tokenId },
    origin: baseUrl(request),
    ...(version !== undefined ? { version } : {}),
  });
  if ('refused' in file) {
    if (file.refused === 'too_large') return json({ error: 'too_large', message: file.message }, 413);
    return json({ error: 'not_found' }, 404);
  }
  const html = renderArtifactFileHtml({ file, code: await offlineBundle(file.bundle) });
  const name = fileName(file.metadata.title);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
