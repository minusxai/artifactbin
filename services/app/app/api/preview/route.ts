import { isCrossSiteRequest, json, readJson, unauthorized } from '@/lib/http';
import { sessionActor } from '@/lib/viewer';
import { parseContentInput } from '@/lib/story/input';
import { resolveToken } from '@/lib/tokens';

/**
 * POST /api/preview { markup, theme?, title? } → { css }: the compiled
 * per-document stylesheet. Pure render, nothing persisted — powers the
 * editor's draft-CSS compile. Requires a session OR a bearer token (it's
 * compute, not data).
 */
export async function POST(request: Request) {
  // Any credential: an agent's bearer, an account session, or the browser's
  // agent-session cookie. The cookie matters here because the EDIT CANVAS
  // compiles draft CSS through this route — an anonymous owner editing their
  // own document would otherwise 401 on every keystroke and see it unstyled.
  // (`sessionActor` swallows auth()'s synchronous throw outside a request
  // scope, e.g. direct handler calls in tests.)
  const bearer = request.headers.get('authorization') ?? '';
  const presented = bearer.startsWith('Bearer ') ? bearer.slice('Bearer '.length).trim() : '';
  const tokenOk = presented ? await resolveToken(presented) : null;
  if (!tokenOk) {
    const actor = await sessionActor(request);
    if (!actor.viewer && !actor.tokenId) return unauthorized(request);
    // Cookie-authenticated: refuse a cross-site caller (this compiles markup).
    if (isCrossSiteRequest(request)) return json({ error: 'forbidden' }, 403);
  }
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  const parsed = await parseContentInput(body);
  if (parsed instanceof Response) return parsed;
  const css = parsed.format === 'markup' ? ((parsed.meta as { compiledCss?: string | null }).compiledCss ?? null) : undefined;
  return json({ html: parsed.content, format: parsed.format, ...(css !== undefined ? { css } : {}) });
}
