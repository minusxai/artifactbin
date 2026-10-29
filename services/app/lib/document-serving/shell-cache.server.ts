/**
 * THE APP PAGE'S SHELL for a document address, answered from the render cache (./render-cache) for a reader who
 * carries nothing that could make their page differ from anyone else's: a GET with no query, no credential and no
 * cookie but the light/dark pick (which the key names). Anything else — a signed-in reader, a token, an export
 * key, a carried grant — takes the uncached path, unchanged.
 *
 * Admission runs on EVERY request, before the cache is consulted: the row's identity columns, read now, and the
 * anonymous read decision on them. A row that has gone private or been deleted is never answered from memory;
 * its version, edit and metadata digest are in the key, so a new version is a miss, never the old body.
 */
import {ANONYMOUS_ACTOR, sessionActor} from '@/lib/accounts';
import {readableArtifactIdentity} from '@/lib/artifacts';
import {baseUrl, parseCookie} from '@/lib/http';
import {runWithRequest} from '@/lib/platform';
import {THEME_KEY} from '@/lib/story-runtime/contract';
import {anonymousReader, renderCache, renderKey, SHELL_TTL_MS, type CachedRender} from './render-cache';

/** What the caller knows of the request that the shell depends on and this module cannot see. */
interface ShellRequest {
  request: Request;
  /** The document the address names, or null when it names none. */
  id: string | null;
  /** The content encoding the response will carry (the server's negotiation), null for identity. */
  encoding: string | null;
  /** The build the page is. */
  build: string | null;
}

const respond = (entry: CachedRender): Response => new Response(entry.body, {status: entry.status, headers: new Headers(entry.headers as Array<[string, string]>)});

/** Only the theme pick may ride along: any other cookie may be a credential or a grant. */
function cookieFree(request: Request): boolean {
  const cookie = request.headers.get('cookie');
  if (!cookie) return true;
  return cookie.split(';').every(part => { const name = part.split('=')[0]!.trim(); return !name || name === THEME_KEY; });
}

export async function cachedShell({request, id, encoding, build}: ShellRequest, render: () => Promise<Response>): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET' || !id || url.search || url.pathname.endsWith('/edit') || request.headers.has('authorization') || !cookieFree(request)) return render();
  const row = await runWithRequest(request, async () => {
    const actor = await sessionActor(request).catch(() => null);
    if (!actor || !anonymousReader(actor)) return null;
    return (await readableArtifactIdentity(ANONYMOUS_ACTOR, id))?.row ?? null;
  });
  // Not admitted (or not anonymous): the uncached path answers, including its own 404.
  if (!row) return render();
  const key = renderKey({
    kind: 'shell', origin: baseUrl(request), path: url.pathname, theme: parseCookie(request.headers.get('cookie'), THEME_KEY) ?? null,
    encoding, build, id: row.id, version: row.version, edit: row.edit_id, updated: row.updated_at, meta: row.meta_digest,
    title: row.title, description: row.description, visibility: row.visibility,
  });
  const hit = renderCache.get(key);
  if (hit) return respond(hit);
  const response = await render();
  if (response.status !== 200 || response.headers.has('set-cookie') || !response.body) return response;
  const entry: CachedRender = {status: response.status, headers: [...response.headers], body: new Uint8Array(await response.arrayBuffer())};
  renderCache.set(key, entry, SHELL_TTL_MS);
  return respond(entry);
}
