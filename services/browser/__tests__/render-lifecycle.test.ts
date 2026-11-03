/**
 * THE RENDER BROWSER'S LIFECYCLE, with real Chromium: what a deadline, the idle shutdown and a relaunch may close.
 * A counting `launch` keeps every Browser the service started, so a test can hold a page of its own on the
 * service's browser (another render's page) and count relaunches. It stays in the `node` project (unlike the
 * integration-only contract.test.ts): a few small pages in about three seconds, the local evidence for these fixes.
 */
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import type { RenderRequest } from '@artifactbin/contracts';
import { createBrowser } from '@artifactbin/browser/local';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';

const READY = '<html><body style="margin:0"><main style="width:100px;height:100px;background:#3c3"></main></body></html>';
const STUCK = '<html><body><main data-mx-chart-state="pending" style="width:100px;height:100px">Loading chart</main></body></html>';

let pages: RunningServer;
beforeAll(async () => {
  pages = await withHttpServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end(q.url === '/stuck' ? STUCK : READY); });
});
afterAll(async () => { await pages.close(); });

const services: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.close())); });

/** A service whose launches are counted, kept and, while `gate` is set, held until the test opens it. */
function counted(idleShutdownMs = 60_000) {
  const launched: Browser[] = [];
  // `overlapped`: a launch began while an earlier browser was still open. `closes` counts closes begun; `closeGate` holds them.
  const state = { launches: 0, closes: 0, overlapped: false, gate: undefined as Promise<void> | undefined, closeGate: Promise.resolve() };
  const service = createBrowser({
    idleShutdownMs,
    launch: async (timeout) => {
      state.launches++;
      state.overlapped ||= launched.some(browser => browser.isConnected());
      if (state.gate) await state.gate;
      const browser = await chromium.launch({ headless: true, timeout });
      const close = browser.close.bind(browser);
      browser.close = async (options) => { state.closes++; await state.closeGate; return close(options); };
      launched.push(browser);
      return browser;
    },
  });
  services.push({ close: async () => { state.closeGate = Promise.resolve(); await service.close(); await Promise.all(launched.map(browser => browser.close().catch(() => {}))); } });
  return { service, launched, state };
}

const request = (path: string, extra: Partial<RenderRequest> = {}): RenderRequest => ({ url: `${pages.base}${path}`, format: 'png', viewport: { width: 200, height: 200 }, selector: 'main', capture: 'full', sameOriginOnly: true, settleMs: 0, timeoutMs: 10_000, ...extra });
const until = async (done: () => boolean) => { while (!done()) await new Promise(resolve => setTimeout(resolve, 10)); };

it('closes only the page that passed its deadline, never another page on the same browser', async () => {
  const { service, launched, state } = counted();
  expect((await service.render(request('/ready'))).ok).toBe(true);
  const [browser] = launched;
  // Another render's page, open on the service's browser while one render runs past its deadline.
  const other = await browser!.newPage();
  await other.setContent('<p>another render</p>');
  const late = await service.render(request('/stuck', { timeoutMs: 400 }));
  expect(!late.ok && late.reason).toBe('failed');
  expect(browser!.isConnected()).toBe(true);
  expect(other.isClosed()).toBe(false);
  expect(await other.evaluate(() => document.body.textContent)).toBe('another render');
  expect((await service.render(request('/ready'))).ok).toBe(true);
  expect(state.launches).toBe(1);
});

it('never shuts the browser down for idleness while a render is using it', async () => {
  const { service, state } = counted(300);
  expect((await service.render(request('/ready'))).ok).toBe(true);
  // The idle shutdown armed by the first render comes due in the middle of the second one's settle.
  await new Promise(resolve => setTimeout(resolve, 100));
  const busy = await service.render(request('/ready', { settleMs: 800 }));
  expect(busy).toMatchObject({ ok: true });
  expect(state.launches).toBe(1);
});

it('keeps the browser a render relaunched after a crash, even when an idle shutdown comes due during the launch', async () => {
  const { service, launched, state } = counted(100);
  expect((await service.render(request('/ready'))).ok).toBe(true);
  await launched[0]!.close(); // the browser crashed between renders
  let open!: () => void;
  state.gate = new Promise<void>(resolve => { open = resolve; });
  const relaunching = service.render(request('/ready'));
  await until(() => state.launches === 2);
  await new Promise(resolve => setTimeout(resolve, 300)); // the idle shutdown is due while the relaunch is in flight
  open();
  expect(await relaunching).toMatchObject({ ok: true });
  expect(state.launches).toBe(2);
  expect(launched[1]!.isConnected()).toBe(true);
});

it('never launches a second browser while the idle shutdown is still closing the first', async () => {
  const { service, launched, state } = counted(100);
  let finishClosing!: () => void;
  state.closeGate = new Promise<void>(resolve => { finishClosing = resolve; });
  expect((await service.render(request('/ready'))).ok).toBe(true);
  await until(() => state.closes === 1); // the idle shutdown has begun closing the first browser
  const next = service.render(request('/ready'));
  await new Promise(resolve => setTimeout(resolve, 300));
  finishClosing();
  expect(await next).toMatchObject({ ok: true });
  expect(state.launches).toBe(2);
  expect(state.overlapped).toBe(false);
  expect(launched[0]!.isConnected()).toBe(false);
});
