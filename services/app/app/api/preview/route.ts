import { PUBLISH_BODY_LIMIT, isCrossSiteRequest, json, readJson, unauthorized } from '@/lib/http';
import { requestOrSessionActor } from '@/lib/authentication';
import { parseContentInput } from '@/lib/publish/document/input';

/**
 * POST /api/preview { markup, theme?, title? } → { html, format, css? }: the
 * parsed content and, for markup, its compiled per-document stylesheet. Pure
 * render, nothing persisted — powers the editor's draft-CSS compile. Requires
 * a session OR a bearer token (it's compute, not data).
 */
export async function POST(request: Request) {
  // Any credential: an agent's bearer, an account session, or the browser's
  // agent-session cookie. The cookie matters here because the EDIT CANVAS
  // compiles draft CSS through this route — an anonymous owner editing their
  // own document would otherwise 401 on every keystroke and see it unstyled.
  const actor = await requestOrSessionActor(request);
  if (!actor.userId && !actor.tokenId) return unauthorized(request);
  // Cookie-authenticated: refuse a cross-site caller (this compiles markup).
  if (actor.credential !== 'bearer' && isCrossSiteRequest(request)) return json({ error: 'forbidden' }, 403);
  const body = await readJson(request, { limit: PUBLISH_BODY_LIMIT });
  if (!body) return json({ error: 'invalid_json' }, 400);
  const parsed = await parseContentInput(body);
  if (parsed instanceof Response) return parsed;
  const css = parsed.format === 'markup' ? ((parsed.meta as { compiledCss?: string | null }).compiledCss ?? null) : undefined;
  return json({ html: '', format: parsed.format, ...(css !== undefined ? { css } : {}) });
}
