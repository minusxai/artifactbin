import { ARTIFACTBIN_AGENT_HEADER, logClientIdentity } from '@/lib/client-identity';
import { baseUrl } from '@/lib/http';
import { serveDocs, skillTree } from '@/lib/skills';

/**
 * GET /docs, /docs/<skill>, /docs/<skill>/<file>.md, /docs?download=true —
 * the whole docs tree through one handler (`lib/skills/serve`).
 *
 * These are AGENT addresses, and they answer the same text to every caller —
 * no `Accept` sniffing. The tour for people is a separate address,
 * `/docs-human`, registered by the app server. Measured both ways: sending a
 * browser Accept to the human page bounced OpenCode's fetch tool out of
 * discovery (run 33702277600); before the split existed at all, Claude Code
 * asked for `/docs` twice, landed on prose for people, and went on guessing
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
    download: url.searchParams.get('download') === 'true',
    transport: url.searchParams.get('transport') === 'mcp' ? 'mcp' : 'curl',
  });
}
