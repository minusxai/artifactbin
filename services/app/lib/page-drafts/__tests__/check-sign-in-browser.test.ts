/**
 * A SIGNED-IN AUTHOR'S DRAFT CHECKED IN A REAL CHROMIUM (POST /api/page/drafts/check on the composed host): a person
 * and an agent signed in as a group, at either level, hear the draft's console error and its overflow, with a picture;
 * the checking browser carries none of the caller's credentials (every request reaching the app is recorded, and the
 * page says what cookie it sees), and a draft aiming at an internal address (fetch, image, frame, stylesheet,
 * WebSocket, beacon, WebRTC's TURN over TCP, a preconnect, and the https image and media its policy admits, which only
 * the browser's own rule stops) never reaches it: a TCP listener there counts every connection (services/browser
 * egress.test.ts aims at every other way out). What it asks of the app is asked as the draft's own origin, so the app
 * answers only its public files (an image its policy admits under /api/users/ is refused 403). As in
 * check-browser.test.ts, only the internal address is this test server's.
 */
import { createServer, type Socket } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getRequestListener } from '@hono/node-server';
import { createBrowser } from '@artifactbin/browser/local';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
import { services, setServices } from '@/lib/platform';
import { pagesSite } from '@/lib/http';
import { useAppHarness } from '@/__tests__/harness';
import { composed, useGroupPrincipalHost, world } from '@/__tests__/group-principal-fixture';
import { createAppServer } from '@/server/app';

useAppHarness();
useGroupPrincipalHost();
const app = createAppServer({ indexHtml: async () => '<html></html>', pagesSite: pagesSite() });
const chromium = createBrowser(), original = services().browser;
const reached: Array<{ url: string; headers: Record<string, unknown> }> = [];
let listening: RunningServer, connections = 0, probe = '';
const internal = createServer((socket: Socket) => { connections++; socket.end('HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok'); });
beforeAll(async () => {
  const listener = getRequestListener(app.fetch);
  listening = await withHttpServer((request, response) => { reached.push({ url: `${request.headers.host}${request.url}`, headers: { ...request.headers } }); return listener(request, response); });
  await new Promise<void>((resolve) => internal.listen(0, '127.0.0.1', resolve));
  probe = `127.0.0.1:${(internal.address() as { port: number }).port}`;
  setServices({ browser: { ...original, inspect: (request) => chromium.inspect!({ ...request, internalOrigin: listening.base }) } });
});
afterAll(async () => { setServices({ browser: original }); await chromium.close(); await listening.close(); await new Promise((resolve) => internal.close(resolve)); });

const b64 = (text: string) => Buffer.from(text).toString('base64');
const draft = () => ({
  entryPath: 'draft.html', files: [{ path: 'data.csv', base64: b64('month,revenue\n2026-01,10\n'), contentType: 'text/csv' }],
  html: `<!doctype html><html><head><meta charset="utf-8"><title>Draft</title>
<link rel="af-dataset" data-af-name="data" href="./data.csv"><link rel="stylesheet" href="http://${probe}/style.css"><link rel="preconnect" href="http://${probe}"></head>
<body style="margin:0"><h1>Quarterly draft</h1><div id="wide" style="width:3000px;height:20px;background:#eee"></div>
<img src="http://${probe}/image.png" alt=""><iframe src="http://${probe}/frame" title="x"></iframe>
<img src="https://${probe}/secure.png" alt=""><video src="https://${probe}/clip.mp4" preload="auto"></video><img src="${pagesSite().app}/api/users/nobody/avatar" alt="">
<script type="module">
console.error('cookie=[' + document.cookie + ']');
fetch('http://${probe}/fetch').catch(() => {});
try { new WebSocket('ws://${probe}/socket'); } catch {}
try { navigator.sendBeacon('http://${probe}/beacon', 'x'); } catch {}
try { const pc = new RTCPeerConnection({ iceServers: [{ urls: 'turn:${probe}?transport=tcp', username: 'u', credential: 'p' }] }); pc.createDataChannel('x'); pc.createOffer().then((offer) => pc.setLocalDescription(offer)); } catch {}
const rows = await fetch('./data.csv').then((answer) => answer.text());
console.error('total is not defined: ' + rows.trim().split('\\n').length + ' lines');
</script></body></html>`,
});

it('a person and a group agent at either level hear the console error and the overflow, checked as no one, reaching nothing internal', async () => {
  const host = await composed(), { eve, team } = await world(host, false);
  const member = await eve.asGroup(team.id, 'member'), editor = await eve.asGroup(team.id, 'editor');
  for (const [who, token] of [['person', eve.token], ['group member', member.token], ['group editor', editor.token]] as const) {
    reached.length = 0;
    // The person's own session cookie rides along with the bearer: neither reaches the checking browser.
    const answered = await host.fetch(new Request('http://localhost:3000/api/page/drafts/check', { method: 'POST',
      headers: { authorization: `Bearer ${token}`, cookie: eve.cookie, 'content-type': 'application/json' }, body: JSON.stringify(draft()) }));
    expect(answered.status, who).toBe(200);
    const found = await answered.json() as { problems: Array<Record<string, string>>; truncated: boolean; image?: Record<string, unknown> };
    expect(found.problems, who).toEqual(expect.arrayContaining([
      { kind: 'console', message: 'cookie=[]' },
      { kind: 'console', message: 'total is not defined: 2 lines' },
      { kind: 'overflow', element: 'div#wide', message: expect.stringMatching(/^the page is \d+px wider than its 1280px window: div#wide sticks out$/) },
      { kind: 'request', message: `GET ${pagesSite().app}/api/users/nobody/avatar answered 403` },
    ]));
    // Asked of the app as the draft's own origin, which the app answers with its public files alone.
    const avatar = reached.find(({ url }) => url.endsWith('/api/users/nobody/avatar'));
    expect(avatar?.headers.origin, who).toMatch(/^https?:\/\/draft-/);
    expect(found.image, who).toMatchObject({ mime: 'image/jpeg', width: 1280, data: expect.any(String) });
    // What the checking browser asked the app for (the draft, its file): no authorization, no cookie, nothing of the caller.
    expect(reached.some(({ url }) => url.endsWith('/draft.html') || url.includes('/draft.html?')), who).toBe(true);
    expect(reached.some(({ url }) => url.endsWith('/data.csv')), who).toBe(true);
    for (const { url, headers } of reached) {
      expect(Object.keys(headers), url).not.toContain('authorization');
      expect(Object.keys(headers), url).not.toContain('cookie');
      for (const secret of [token, eve.cookie]) expect(JSON.stringify(headers), url).not.toContain(secret);
    }
  }
  expect(connections).toBe(0);
}, 90_000);
