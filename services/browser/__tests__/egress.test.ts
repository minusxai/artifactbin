/**
 * NOTHING A RENDERED PAGE DOES LEAVES THE BROWSER, in a real Chromium, for an export (render and harvest: the page on
 * its own origin, asked over the network), a hosted check and a draft check (inspect: the page loaded from the
 * internal origin). A page aims every way Chromium can reach a network at TCP and UDP listeners on loopback and on a
 * second local address, by address and by a name (`*.localhost`, which Chromium itself resolves to loopback unless its
 * resolver is closed): WebRTC (STUN, TURN over UDP and TCP; no host candidate may name a local address),
 * dns-prefetch, preconnect, prefetch, WebSocket, WebTransport, fetch with keepalive, sendBeacon, `<a ping>`, an image,
 * a video, a font, a CSS import, a frame, a redirect from the page's own origin, and the same again from a worker and
 * from nested `blob:` and `data:` frames. Every listener must count 0, and what a check says must be the same whether
 * a listener was there or not (no port scan through `problems`).
 */
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { createServer, type Server } from 'node:net';
import { networkInterfaces } from 'node:os';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createBrowser } from '@artifactbin/browser/local';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
import { processTable } from '../src/render-limits';

/** The second local address: this machine's first external IPv4, else another loopback address (Linux owns 127/8). */
const second = Object.values(networkInterfaces()).flat().find((nic) => nic && nic.family === 'IPv4' && !nic.internal)?.address
  ?? (process.platform === 'linux' ? '127.0.0.2' : '127.0.0.1');
const addresses = [...new Set(['127.0.0.1', second])];

type Probe = { address: string; tcp: Server; udp: UdpSocket; tcpPort: number; udpPort: number };
const probes: Probe[] = [];
const counted = { tcp: 0, udp: 0 };
const sockets = new Set<import('node:net').Socket>();
let site: RunningServer;
const chromium = createBrowser();

async function listen(address: string): Promise<Probe> {
  const tcp = createServer((socket) => { counted.tcp++; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); socket.end('HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok'); });
  await new Promise<void>((resolve) => tcp.listen(0, address, resolve));
  const udp = createSocket('udp4');
  udp.on('message', () => { counted.udp++; });
  await new Promise<void>((resolve) => udp.bind(0, address, resolve));
  return { address, tcp, udp, tcpPort: (tcp.address() as { port: number }).port, udpPort: udp.address().port };
}

/** What the page aims at: every probe by address, and loopback's by a name only Chromium's own resolver would answer. */
function targets(live: boolean) {
  const tcp: string[] = [], udp: string[] = [];
  for (const probe of probes) {
    const [t, u] = live ? [probe.tcpPort, probe.udpPort] : [deadPorts[probe.address]!.tcp, deadPorts[probe.address]!.udp];
    tcp.push(`${probe.address}:${t}`); udp.push(`${probe.address}:${u}`);
    if (probe.address === '127.0.0.1') { tcp.push(`probe.localhost:${t}`); udp.push(`probe.localhost:${u}`); }
  }
  return { tcp, udp };
}
const deadPorts: Record<string, { tcp: number; udp: number }> = {};

/** The attack, as source a window, a worker and a nested frame each run (it uses only what its scope has). */
const ATTACK = String.raw`(T) => {
  const say = (line) => console.error('egress ' + line);
  for (const t of T.tcp) {
    fetch('http://' + t + '/fetch', { mode: 'no-cors', keepalive: true }).catch(() => {});
    try { const ws = new WebSocket('ws://' + t + '/socket'); ws.onerror = () => {}; } catch {}
    try { new WebTransport('https://' + t + '/wt').ready.catch(() => {}); } catch {}
    try { navigator.sendBeacon('http://' + t + '/beacon', 'x'); } catch {}
  }
  for (const u of T.udp) { try { new WebTransport('https://' + u + '/wt').ready.catch(() => {}); } catch {} }
  if (typeof RTCPeerConnection === 'function') {
    const iceServers = [
      ...T.udp.map((u) => ({ urls: 'stun:' + u })),
      ...T.udp.map((u) => ({ urls: 'turn:' + u + '?transport=udp', username: 'u', credential: 'p' })),
      ...T.tcp.map((t) => ({ urls: 'turn:' + t + '?transport=tcp', username: 'u', credential: 'p' })),
    ];
    // The page's own constructor, and two ways around anything that wraps it: the prototype's constructor and a
    // fresh frame's, taken before any script of the frame's own could run.
    const fresh = typeof document === 'object' ? document.body.appendChild(document.createElement('iframe')).contentWindow : null;
    for (const Peer of [RTCPeerConnection, RTCPeerConnection.prototype.constructor, fresh && fresh.RTCPeerConnection]) {
      if (typeof Peer !== 'function') continue;
      try {
        const pc = new Peer({ iceServers, iceCandidatePoolSize: 1 });
        pc.onicecandidate = (event) => { if (event.candidate && event.candidate.candidate) say('candidate ' + event.candidate.candidate); };
        pc.onicecandidateerror = (event) => say('candidate error ' + event.errorCode);
        pc.createDataChannel('x');
        pc.createOffer().then((offer) => pc.setLocalDescription(offer)).catch(() => {});
      } catch {}
    }
  }
  if (typeof document === 'object') {
    const add = (html) => { const box = document.createElement('div'); box.innerHTML = html; document.body.append(box); };
    for (const t of T.tcp) {
      for (const rel of ['dns-prefetch', 'preconnect', 'prefetch', 'prerender', 'preload']) {
        const link = document.createElement('link'); link.rel = rel; link.href = 'http://' + t + '/' + rel; if (rel === 'preload') link.as = 'image'; document.head.append(link);
      }
      add('<img src="http://' + t + '/img.png" alt=""><video src="http://' + t + '/clip.mp4" preload="auto"></video>'
        + '<iframe src="http://' + t + '/frame"></iframe><style>@import url("http://' + t + '/import.css");'
        + '@font-face{font-family:probe;src:url("http://' + t + '/font.woff2")}.probe{font-family:probe}</style><p class="probe">font</p>'
        + '<a id="ping" href="#here" ping="http://' + t + '/ping">ping</a>');
      document.querySelectorAll('a[ping]').forEach((a) => a.click());
    }
    const spec = document.createElement('script');
    spec.type = 'speculationrules';
    spec.textContent = JSON.stringify({ prerender: [{ source: 'list', urls: T.tcp.map((t) => 'http://' + t + '/speculated') }], prefetch: [{ source: 'list', urls: T.tcp.map((t) => 'http://' + t + '/prefetched') }] });
    document.head.append(spec);
  }
}`;

/** The page: the attack in the window, in a worker, in a blob: frame and a data: frame (each also starting a worker), and a redirect. */
function attackPage(live: boolean): string {
  const t = JSON.stringify(targets(live));
  const run = `(${ATTACK})(${t});`;
  const worker = `new Worker(URL.createObjectURL(new Blob([${JSON.stringify(run)}], { type: 'text/javascript' })));`;
  const framed = `<!doctype html><body><p>frame</p><script>${run}${worker}</` + `script></body>`;
  const inline = (text: string) => JSON.stringify(text).replaceAll('</', '<\\/');
  return `<!doctype html><html><head><meta charset="utf-8"><title>egress</title></head><body><h1>Egress</h1>
<img src="/redirect" alt="">
<script>
${run}
${worker}
const blobFrame = document.createElement('iframe'); blobFrame.src = URL.createObjectURL(new Blob([${inline(framed)}], { type: 'text/html' })); document.body.append(blobFrame);
const dataFrame = document.createElement('iframe'); dataFrame.src = 'data:text/html;base64,' + btoa(${inline(framed)}); document.body.append(dataFrame);
fetch('/redirect').catch(() => {});
</script></body></html>`;
}

let live = true;
beforeAll(async () => {
  for (const address of addresses) probes.push(await listen(address));
  // Ports that were bound a moment ago and are free now: the "no listener" run aims at these.
  for (const address of addresses) {
    const gone = await listen(address);
    deadPorts[address] = { tcp: gone.tcpPort, udp: gone.udpPort };
    await new Promise((resolve) => gone.tcp.close(resolve)); gone.udp.close();
  }
  site = await withHttpServer((request, response) => {
    if (request.url?.startsWith('/redirect')) { response.writeHead(302, { location: `http://${targets(live).tcp[0]}/redirected` }); return response.end(); }
    if (request.url?.startsWith('/page')) { response.writeHead(200, { 'content-type': 'text/html' }); return response.end(attackPage(live)); }
    response.writeHead(404); response.end();
  });
});
afterAll(async () => {
  await chromium.close(); await site.close();
  for (const socket of sockets) socket.destroy();
  for (const probe of probes) { await new Promise((resolve) => probe.tcp.close(resolve)); probe.udp.close(); }
});

const page = { viewport: { width: 800, height: 600 }, selector: 'body', settleMs: 4_000, timeoutMs: 20_000 } as const;
/** Each operation that renders an author's page: an export's render and harvest, and a check (hosted or draft). */
const operations = {
  render: () => chromium.render({ ...page, url: `${site.base}/page`, format: 'png', capture: 'full', sameOriginOnly: true }),
  harvest: () => chromium.harvestSvg!({ ...page, url: `${site.base}/page`, collect: 'figure', sameOriginOnly: true }),
  check: () => chromium.inspect!({ ...page, url: 'http://draft.lvh.me:9/page', sameOriginOnly: true, allowedOrigins: ['http://app.lvh.me:9'], internalOrigin: site.base }),
};

/** What a check said, with each aimed address put back to the same words for a live and a dead target. */
function said(problems: Array<{ kind: string; message: string }>, run: boolean): string[] {
  const { tcp, udp } = targets(run);
  const words = (text: string) => [...tcp, ...udp].reduce((at, target, i) => at.replaceAll(target, `<target ${i}>`), text);
  return [...new Set(problems.map((problem) => `${problem.kind}: ${words(problem.message)}`))].sort();
}

it('reaches no listener and resolves no name, for an export, a hosted check and a draft check alike', async () => {
  const found: Record<string, unknown> = {};
  for (const [name, run] of Object.entries(operations)) {
    counted.tcp = 0; counted.udp = 0;
    const answer = await run() as { ok: boolean; problems?: Array<{ kind: string; message: string }> };
    // A candidate would tell the page (and through `problems`, its author) this machine's addresses, or that it has some.
    const candidates = (answer.problems ?? []).filter((problem) => /egress candidate /.test(problem.message)).length;
    found[name] = { ok: answer.ok, tcp: counted.tcp, udp: counted.udp, candidates };
  }
  const none = { ok: true, tcp: 0, udp: 0, candidates: 0 };
  expect(found).toEqual({ render: none, harvest: none, check: none });
  // Both render browsers (still up, idle) resolve no name themselves, go only to their refuse-all proxy, and give
  // WebRTC no unproxied UDP: the launch every render's own proxy sits on.
  const browsers = (await processTable()).filter((row) => row.ppid === process.pid && row.command.includes('--artifactbin-render-lane='));
  expect(browsers.map((row) => /--artifactbin-render-lane=(\w+)/.exec(row.command)?.[1]).sort()).toEqual(['checks', 'exports']);
  for (const browser of browsers) for (const flag of ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', '--proxy-server=http://127.0.0.1:', '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-quic'])
    expect(browser.command).toContain(flag);
}, 120_000);

it('says the same of a page aiming at listeners as of one aiming at closed ports: no scan through the answer', async () => {
  live = true;
  const aimed = await operations.check();
  live = false;
  const closed = await operations.check();
  live = true;
  expect(aimed.ok && closed.ok).toBe(true);
  if (!aimed.ok || !closed.ok) return;
  expect(said(aimed.problems, true)).toEqual(said(closed.problems, false));
}, 120_000);
