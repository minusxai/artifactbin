/**
 * WHO IS SERVED WHAT AT /a/<id> — the per-persona matrix the reader-shell gate used to walk in a browser
 * (scripts/gates/gate-reader-shell.mjs keeps the crawler's frame mount, the JavaScript-off read and the chrome).
 *
 * One fixture set, every reader the address meets: nobody, a crawler, a signed-in stranger and the owner's account
 * session (the gate's "anonymous owner" and "split viewer" hold exactly that: the approval cookie of a token the
 * account claimed is an account session, scripts/lib/start-doc.mjs becomeOwner). Each reads a public and a
 * private document through the real app server; a reader who may read gets the app page framing the document on
 * its own origin (`<hex id>.<pages host>`) and, through the pages exchange, the document itself; a reader who may
 * not gets the uniform 404 and never the words.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request, setSession, framedDocument, mintAccountToken } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { claimToken, createUser, ensureUsername } from '@/lib/accounts';
import { pagesOriginFor, pagesSite } from '@/lib/http/pages-origin';
import { drainPreparedPageWarmups } from '@/lib/story/prepared/prepared-page.server';
import { createAppServer } from '@/server/app';

useAppHarness();

const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>' });
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

async function world() {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_shell_owner@example.com' }));
  const stranger = await createUser({ email: 'mxmx_test_shell_stranger@example.com' });
  const held = await mintAccountToken('shell-owner', owner.id);
  expect(await claimToken(owner.id, held.token)).not.toBeNull();
  const publish = async (json: Record<string, unknown>) => {
    const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: held.token, json }));
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as { id: string; visibility: string };
  };
  const pub = await publish({ title: 'Crawlable doc', visibility: 'public', markup: '<Helmet><title>Crawlable doc</title><meta name="description" content="A document that indexes." /></Helmet><h1>PUBLIC-WORDS</h1>' });
  const priv = await publish({ title: 'Claimed Private', markup: '<h1>PRIVATE-WORDS</h1>' });
  const folder = await publish({ format: 'folder', title: 'Vault' });
  await drainPreparedPageWarmups();
  return { owner, stranger, held, pub, priv, folder };
}

type World = Awaited<ReturnType<typeof world>>;
/** A reader: who `auth()` says is signed in, and the user-agent it sends. */
interface Persona { name: string; session: (w: World) => { id: string; email: string } | null; userAgent?: string; readsPrivate: boolean }
const PERSONAS: Persona[] = [
  { name: 'nobody', session: () => null, readsPrivate: false },
  { name: 'a crawler', session: () => null, userAgent: GOOGLEBOT, readsPrivate: false },
  { name: 'a signed-in stranger', session: (w) => ({ id: w.stranger.id, email: w.stranger.email! }), readsPrivate: false },
  { name: 'the owner', session: (w) => ({ id: w.owner.id, email: w.owner.email! }), readsPrivate: true },
];

async function read(persona: Persona, w: World, id: string) {
  const who = persona.session(w);
  setSession(who ? { user: { id: who.id, email: who.email } } : null);
  const headers: Record<string, string> = { accept: 'text/html', ...(persona.userAgent ? { 'user-agent': persona.userAgent } : {}) };
  const page = await app.request(`/a/${id}`, { headers });
  const html = await page.text();
  const frame = /<iframe data-mx-document-frame="" src="([^"]+)"/.exec(html)?.[1]?.replaceAll('&amp;', '&') ?? null;
  const document = page.status === 200 ? await (await framedDocument(app, `/a/${id}`, { headers }))?.text() ?? null : null;
  return { status: page.status, html, frame, document };
}

describe('the persona matrix', () => {
  for (const persona of PERSONAS) {
    it(`${persona.name}: a public document is the app page framing it on its own origin, and the frame reads`, async () => {
      const w = await world();
      const got = await read(persona, w, w.pub.id);
      expect(got.status).toBe(200);
      expect(got.html).toMatch(/<title>[^<]*Crawlable doc/);
      expect(got.html).toContain(`/a/${w.pub.id}/export`);
      expect(got.html).toMatch(/property="og:title"|name="og:title"/);
      expect(new URL(got.frame!).origin === pagesOriginFor(w.pub.id, pagesSite()) || new URL(got.frame!).pathname === '/pages-session').toBe(true);
      expect(got.document).toContain('PUBLIC-WORDS');
    });

    it(`${persona.name}: a private document is ${persona.readsPrivate ? 'read in its frame' : 'the uniform 404, words and all'}`, async () => {
      const w = await world();
      const got = await read(persona, w, w.priv.id);
      if (persona.readsPrivate) {
        expect(got.status).toBe(200);
        expect(got.document).toContain('PRIVATE-WORDS');
      } else {
        expect(got.status).toBe(404);
        expect(got.html).not.toContain('PRIVATE-WORDS');
        expect(got.frame).toBeNull();
      }
    });
  }

  it('a crawler user-agent gets the same page as anyone else — nothing is cloaked', async () => {
    const w = await world();
    setSession(null);
    const dropScripts = (h: string) => h.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/\s+/g, ' ').trim();
    const plain = await (await app.request(`/a/${w.pub.id}`, { headers: { accept: 'text/html' } })).text();
    const bot = await (await app.request(`/a/${w.pub.id}`, { headers: { accept: 'text/html', 'user-agent': GOOGLEBOT } })).text();
    // The frame src carries a per-request ticket only for a signed-in reader; a session-less one has none.
    expect(dropScripts(bot)).toBe(dropScripts(plain));
  });

  it('an owned document and an owned folder are both born private', async () => {
    const w = await world();
    expect(w.priv.visibility).toBe('private');
    expect(w.folder.visibility).toBe('private');
  });

  it('agent discovery teaches the CLI without internal raw links', async () => {
    setSession(null);
    const llms = await (await app.request('/llms.txt')).text();
    expect(llms).toContain('afbin');
    expect(llms).not.toContain('/raw');
  });

  it('/raw still answers a public document (the internal address embeds use)', async () => {
    const w = await world();
    setSession(null);
    expect((await app.request(`/a/${w.pub.id}/raw`)).status).toBe(200);
  });
});
