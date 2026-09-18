/**
 * The hop a browser session's page requests take.
 *
 * The bug this guards is invisible from the app's own tests: in development the SPA's
 * modules come from Vite, which sits in front of the LISTENER, so a session wired to
 * the app object alone gets a 404 for `/@vite/client` and the page never hydrates —
 * the failure looks like a broken document, not a broken hop. Both branches are
 * exercised against a real socket: the development one must reach the Vite-fronted
 * chain carrying a verifiable actor, and the deployment one must open no socket at all.
 */
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTOR_HEADER, ANONYMOUS, type Actor } from '@artifactbin/contracts';
import { actorOf, verifyActor } from '@artifactbin/utils';
import { sessionBridge } from '../session-bridge';

const SECRET = 'a-per-boot-secret-0000000000000000000000';
const VITE_MODULE = 'export const hmr = true;\n';

/** The dev shape in miniature: a Vite-ish middleware in FRONT of the app's listener. */
let server: http.Server;
let port = 0;
const seen: { url: string; actor: Actor | null }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const actor = verifyActor(req.headers[ACTOR_HEADER] as string | undefined, SECRET);
    seen.push({ url: req.url!, actor });
    // Vite claims its own paths before anything else looks at the request.
    if (req.url!.startsWith('/@vite/') || req.url!.startsWith('/@react-refresh')) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(VITE_MODULE);
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><p>${actor ? actor.userId ?? 'anonymous' : 'no actor'}</p>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : 0;
});

afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

/** The app object, which in the deployment shape answers without a socket. */
const app = {
  fetch: async (request: Request) => Response.json({ inProcess: true, actor: actorOf(request) }),
};

describe('a browser session\'s page hop', () => {
  it('in development travels the real chain, so Vite serves the session the modules a browser gets', async () => {
    const owner: Actor = { credential: 'bearer', userId: 'usr_owner' };
    const bridge = sessionBridge({ dev: true, port, secret: SECRET, app });

    const module = await bridge(new Request(`http://localhost:${port}/@vite/client`), owner);
    expect(module.status).toBe(200);
    expect(await module.text()).toBe(VITE_MODULE);

    const page = await bridge(new Request(`http://localhost:${port}/a/abc123`), owner);
    expect(await page.text()).toContain('usr_owner');

    // The actor arrived signed, so the app can tell who the session browses as.
    expect(seen.map((entry) => entry.url)).toEqual(['/@vite/client', '/a/abc123']);
    expect(seen.every((entry) => entry.actor !== null)).toBe(true);
    expect(seen[1]!.actor).toEqual(owner);

    // A guest session is anonymous over the same hop, not unauthenticated-by-accident.
    const guest = await bridge(new Request(`http://localhost:${port}/a/abc123`), ANONYMOUS);
    expect(await guest.text()).toContain('anonymous');
    expect(seen[2]!.actor).toEqual(ANONYMOUS);
  });

  it('stays in-process in a deployment, and without a secret to sign with', async () => {
    const owner: Actor = { credential: 'bearer', userId: 'usr_owner' };
    const before = seen.length;

    const deployed = await sessionBridge({ dev: false, port, secret: SECRET, app })(new Request('http://app/a/abc123'), owner);
    expect(await deployed.json()).toEqual({ inProcess: true, actor: owner });

    const unsigned = await sessionBridge({ dev: true, port, secret: undefined, app })(new Request('http://app/a/abc123'), owner);
    expect(await unsigned.json()).toEqual({ inProcess: true, actor: owner });

    // Neither opened a socket: the listener above saw nothing more.
    expect(seen.length).toBe(before);
  });
});
