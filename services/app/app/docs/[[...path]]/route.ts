import { ARTIFACTBIN_AGENT_HEADER, logClientIdentity } from '@/lib/client-identity';
import { baseUrl } from '@/lib/http';
import { serveDocs, skillTree } from '@/lib/skills';

/**
 * GET /docs, /docs/<skill>, /docs/<skill>/<file>.md, /docs?download=true —
 * the whole docs tree through one handler (`lib/skills/serve`). `/docs/human`
 * is the page for people and is registered ahead of this route by the app
 * server, since a catch-all mounted before the SPA fallback would swallow it.
 *
 * The split for `/docs` itself is by what the CLIENT ASKED FOR: a browser
 * sends `Accept: text/html` and gets the tour, anything else gets the
 * listing. Measured before that rule existed: Claude Code asked for `/docs`
 * twice, followed a 307 to a page written for people, and went on guessing
 * four more 404s before it found the protocol on its tenth request.
 */
export async function GET(request: Request, ctx: { params: Promise<{ path?: string | string[] }> }) {
  const { path } = await ctx.params;
  const url = new URL(request.url);
  const rel = Array.isArray(path) ? path.join('/') : (path ?? '');
  logClientIdentity(rel ? 'docs:file' : 'docs:index', {
    agentHeader: request.headers.get(ARTIFACTBIN_AGENT_HEADER),
    userAgent: request.headers.get('user-agent'),
  });
  return serveDocs({
    tree: skillTree(),
    base: baseUrl(request),
    path: rel,
    accept: request.headers.get('accept') ?? '',
    download: url.searchParams.get('download') === 'true',
    transport: url.searchParams.get('transport') === 'mcp' ? 'mcp' : 'curl',
  });
}
