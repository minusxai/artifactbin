import { buildDocsIndex } from '@/lib/skills';
import { ARTIFACTBIN_AGENT_HEADER, logClientIdentity } from '@/lib/client-identity';
import { baseUrl, MARKDOWN_CONTENT_TYPE } from '@/lib/http';

/**
 * GET /llms.txt — the docs INDEX, at the address agents GUESS.
 *
 * Measured: Claude Code, given a start link and no doc index, probed
 * `/llms.txt`, `/api/docs`, `/api/components` and `/api/artifacts/<id>/schema`
 * on one task — four 404s before it found its way. `/llms.txt` is the one of
 * those with a convention behind it, so it is the one worth answering.
 *
 * It used to serve the whole protocol doc, so a guess cost no second fetch.
 * That backfired: an agent fetched `/llms.txt` AND `/docs/llm` and read the
 * same 30 KB twice. Now it is the llmstxt.org shape — a small map of links
 * (`buildDocsIndex`) — and the large doc lives at exactly one address.
 */
export async function GET(request: Request) {
  logClientIdentity('docs:llms-txt', {
    agentHeader: request.headers.get(ARTIFACTBIN_AGENT_HEADER),
    userAgent: request.headers.get('user-agent'),
  });
  return new Response(buildDocsIndex(baseUrl(request)), {
    status: 200,
    headers: { 'Content-Type': MARKDOWN_CONTENT_TYPE, 'Cache-Control': 'no-store' },
  });
}
