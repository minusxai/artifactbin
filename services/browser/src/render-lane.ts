/**
 * ONE RENDER LANE: `createRenderLane(name, o)` is one Chromium, launched on first use and closed after a minute idle
 * (./browser-holder owns that lifecycle), with a SERIAL queue (`queue`: one page at a time bounds memory) and, while one
 * of its pages is open, its renderers measured against ./render-limits (one past a limit is killed).
 *
 * `readyPage(req, scale, use, listen?)` is ONE PAGE, LOADED AND SETTLED — what every operation that looks at a page
 * shares: the deadline, which closes that page (its own context), never the browser; the page with service workers
 * blocked; the context-wide admission/forwarding route; navigation; and every readiness wait (the surface, the settle,
 * data reads, charts and tables). `use` sees the ready page (`ReadyPage`); the page is closed after, whatever
 * happened. Each page has its own context behind its own egress proxy (./egress): it reaches exactly the origins it
 * may load, nothing else, by any protocol; the browser is launched behind a proxy that refuses everything, with no
 * name resolution, no unproxied WebRTC UDP and no QUIC (EGRESS_ARGS), with only the environment Chromium needs
 * (`chromiumEnv`, never this process's secrets), and in Chromium's own sandbox when `o.sandbox` says so.
 */
import { chromium, errors, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import type { PageRequest } from '@artifactbin/contracts';
import { internalAssetResponse, internalPageResponse } from './internal-assets';
import { createBrowserHolder } from './browser-holder';
import { EGRESS_ARGS, openEgress, type Egress } from './egress';
import { RENDER_LIMIT_POLL_MS, processTable, rendererPastLimits, type RenderLimits } from './render-limits';
import type { RenderSandboxChoice } from './session-config';

export const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SETTLE_MS = 1_500;
/** A timed-out page that will not close within this is a wedged browser, which is then retired. */
const PAGE_CLOSE_WAIT_MS = 5_000;

/**
 * A page's own data reads: its SQL and query doors on the render URL's origin. Each answers and ends (the app bounds
 * them); a long-lived stream (`regions/stream`, events) is not one, so it never holds a capture.
 */
const DATA_READ_PATH = /^\/api\/artifacts\/[^/]+\/(?:sql|query)$/;
/** After the last data read ends, how long the page gets to draw what it read before readiness goes on. */
const DATA_QUIET_MS = 500;
function isDataRead(target: string, pageOrigin: string): boolean {
  try { const url = new URL(target); return url.origin === pageOrigin && DATA_READ_PATH.test(url.pathname); } catch { return false; }
}

export class NavigationError extends Error {}

export function requestOriginAllowed(target:string,pageOrigin:string,allowedOrigins:string[]=[]):boolean {
  if(target.startsWith('data:')||target.startsWith('blob:'))return true;
  try{return new Set([pageOrigin,...allowedOrigins]).has(new URL(target).origin);}catch{return false;}
}

/** Serialized into Chromium: keep this predicate synchronous and self-contained. */
function chartsSettled(selector:string):boolean {
 const root=document.querySelector(selector);
 // A hosted <af-chart> is aria-busy while it loads its engine, rows or draws; an <af-data-table sql> until its read answers.
 const busy='af-chart[aria-busy="true"],af-data-table[aria-busy="true"]';
 return !!root&&!root.matches(busy)&&!root.querySelector(busy);
}

/**
 * The only environment a render browser is started with: what Chromium needs to find its files, fonts and locale.
 * Everything else this process holds (the internal service secret, upload and session credentials) stays here.
 */
const CHROMIUM_ENV = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TZ', 'FONTCONFIG_PATH', 'FONTCONFIG_FILE',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR', 'SystemRoot', 'WINDIR', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE'] as const;
export function chromiumEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(CHROMIUM_ENV.flatMap((name) => source[name] !== undefined ? [[name, source[name]!]] : []));
}
/** A renderer's V8 heap, in MB: past it the page's script runs out of memory inside the page (./render-limits). */
const RENDERER_HEAP_MB = 1024;

/**
 * Serialized into every frame of a render BEFORE its scripts (an init script), defence beneath the egress proxy: a
 * page's RTCPeerConnection is given no ICE server (it still constructs, so a page that only makes one is unchanged).
 * Self-contained.
 */
function quietPeerConnections(): void {
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection'] as const) {
    const scope = window as unknown as Record<string, unknown>;
    const Original = scope[name] as (new (config?: RTCConfiguration) => RTCPeerConnection) | undefined;
    if (typeof Original !== 'function') continue;
    const set = Original.prototype.setConfiguration;
    Original.prototype.setConfiguration = function (this: RTCPeerConnection, config?: RTCConfiguration) { return set.call(this, { ...(config ?? {}), iceServers: [] }); };
    const Quiet = function (config?: RTCConfiguration) { return new Original({ ...(config ?? {}), iceServers: [] }); } as unknown as typeof Original;
    Quiet.prototype = Original.prototype;
    Object.defineProperty(Original.prototype, 'constructor', { value: Quiet, writable: true, configurable: true });
    Object.setPrototypeOf(Quiet, Original);
    scope[name] = Quiet;
  }
}

/** A page's renderer stopped: past ./render-limits, or crashed on its own. */
export class RendererStopped extends Error {}

/** The ready page an operation is handed: its surface (`req.selector`), its time left, and the charts wait it may repeat. */
export type ReadyPage = { page: Page; surface: Locator; timeout: number; remaining: () => number; waitForCharts: () => Promise<void> };
/** Listens to the page from its first request: `refused` names a request this lane refused by its own rule (sameOriginOnly). */
type PageListener = { page(page: Page): void; refused(url: string): void };
export interface RenderLane {
  /** `job` after every job queued before it has settled, whatever their outcome. */
  queue<T>(job: () => Promise<T>): Promise<T>;
  readyPage<T>(req: PageRequest & { internalOrigin?: string }, deviceScaleFactor: number, use: (ready: ReadyPage) => Promise<T>, listen?: PageListener): Promise<T>;
  /** Launches the browser now (or fails), within `timeoutMs`. */
  warm(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
}

/**
 * `launch` replaces Playwright's own launch (and so ignores `executablePath`, the sandbox and the egress launch); tests
 * count and hold browsers with it. `executablePath` is read at each launch. The marker names the lane's process for
 * ./render-limits.
 */
export function createRenderLane(name: 'exports' | 'checks', o: { idleMs: number; launch?: (timeoutMs: number) => Promise<Browser>; sandbox: RenderSandboxChoice; limits: RenderLimits; executablePath: () => string | undefined }): RenderLane {
  const { executablePath } = o;
  const timer = (run: () => void, ms: number) => { const timer = setTimeout(run, ms); timer.unref?.(); return () => clearTimeout(timer); };
  const marker = `--artifactbin-render-lane=${name}`;
  const holder = createBrowserHolder<Browser>({
    idleMs: o.idleMs,
    launch: async (timeoutMs) => {
      if (o.launch) return o.launch(timeoutMs);
      // The browser's own proxy refuses everything: a context opened without its render's proxy reaches nothing.
      const refuseAll: Egress = await openEgress([]);
      try {
        const browser = await chromium.launch({ headless: true, timeout: timeoutMs, chromiumSandbox: o.sandbox.mode === 'chromium', env: chromiumEnv(process.env),
          proxy: { server: refuseAll.server }, args: [...EGRESS_ARGS, `--js-flags=--max-old-space-size=${RENDERER_HEAP_MB}`, marker], ...(executablePath() ? { executablePath: executablePath() } : {}) });
        browser.on('disconnected', () => { void refuseAll.close(); });
        return browser;
      } catch (error) { await refuseAll.close(); throw error; }
    },
    timer,
  });
  let busy = 0, polling: ReturnType<typeof setInterval> | undefined;
  /** While a page of this lane is open, its renderers are measured; one past a limit is killed. */
  const watch = () => {
    if (busy++ > 0) return;
    let measuring = false;
    polling = setInterval(() => {
      if (measuring) return;
      measuring = true;
      void processTable().then((rows) => {
        for (const row of rendererPastLimits(rows, marker, o.limits, process.pid)) { try { process.kill(row.pid, 'SIGKILL'); } catch { /* already gone */ } }
      }).finally(() => { measuring = false; });
    }, RENDER_LIMIT_POLL_MS);
    polling.unref?.();
  };
  const unwatch = () => { if (--busy === 0) clearInterval(polling); };

  /** Closes this page's context; one that will not close in time means its browser is wedged, so that browser is retired. */
  const closePage = async (context: BrowserContext, browser: Browser) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const closed = await Promise.race([context.close().then(() => true, () => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), PAGE_CLOSE_WAIT_MS); })]);
    clearTimeout(timer);
    if (!closed) await holder.retire(browser);
  };

  async function readyPage<T>(req: PageRequest & { internalOrigin?: string }, deviceScaleFactor: number, use: (ready: ReadyPage) => Promise<T>, listen?: PageListener): Promise<T> {
    const deadline=Date.now()+(req.timeoutMs??DEFAULT_TIMEOUT_MS);
    const remaining=()=>{const ms=deadline-Date.now();if(ms<=0)throw new Error('Render deadline');return ms;};
    const lease = await holder.acquire(remaining());
    watch();
    let egress: Egress | undefined;
    // The deadline closes THIS page (with its own context), never the browser another render may be using.
    let context: BrowserContext | undefined;
    let crashed = false;
    let expired = false;
    let deadlineClose: Promise<void> | undefined;
    let renderTimer: ReturnType<typeof setTimeout> | undefined;
    // The deadline closing the page, or Playwright's own timeout, rejects navigation too: that is the render's
    // budget running out (a 'failed' render, like a late success), never a page that could not be reached.
    const deadlineElapsed=(e:unknown)=>expired||e instanceof errors.TimeoutError;
    const forwarding = new AbortController();
    const pending = new Set<Promise<void>>();
    try {
      // What this render may reach over the network: nothing when everything it loads is fetched from the internal
      // origin (an inspection), else its own origin and the ones it was allowed. Everything else is refused (./egress).
      egress = await openEgress(req.internalOrigin ? [] : [new URL(req.url).origin, ...(req.allowedOrigins ?? [])]);
      renderTimer = setTimeout(() => { expired = true; if (context) deadlineClose = closePage(context, lease.browser); }, remaining());
      // reducedMotion: the motion kit never arms scroll reveals under it, so a capture always sees the finished page.
      context = await lease.browser.newContext({ viewport: req.viewport, reducedMotion: 'reduce', deviceScaleFactor, serviceWorkers: 'block', proxy: { server: egress.server } });
      if (expired) { deadlineClose = closePage(context, lease.browser); throw new Error('Render deadline'); }
      await context.addInitScript(quietPeerConnections);
      const page = await context.newPage();
      if (expired) throw new Error('Render deadline');
      page.on('crash', () => { crashed = true; });
      listen?.page(page);
      const timeout = remaining();
      if (req.sameOriginOnly || req.assetOrigin || req.internalOrigin) {
        const origin = new URL(req.url).origin;
        // Context routing also covers popup first requests. Service workers are
        // disabled above so no worker can bypass this admission/forwarding seam.
        await page.context().route('**/*', route => {
          const run = (async () => {
            const request = route.request();
            try {
              if (req.assetOrigin && new URL(request.url()).origin === req.assetOrigin) {
                const signal = AbortSignal.any([forwarding.signal, AbortSignal.timeout(Math.min(timeout, DEFAULT_TIMEOUT_MS))]);
                const response = await internalAssetResponse(request.url(), request.method(), req.assetOrigin, origin, signal);
                await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
              } else if (req.internalOrigin && !/^(?:data|blob):/.test(request.url()) && requestOriginAllowed(request.url(), origin, req.allowedOrigins)) {
                // Inspection: the page's own and allowed origins are fetched from the app itself (contracts PageInspectRequest).
                const signal = AbortSignal.any([forwarding.signal, AbortSignal.timeout(Math.min(timeout, DEFAULT_TIMEOUT_MS))]);
                const response = await internalPageResponse(request.url(), request.method(), req.internalOrigin, origin, signal);
                await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
              } else if (!req.sameOriginOnly || requestOriginAllowed(request.url(), origin, req.allowedOrigins)) await route.continue();
              else { listen?.refused(request.url()); await route.abort(); }
            } catch { await route.abort().catch(() => {}); }
          })();
          pending.add(run); void run.finally(() => pending.delete(run));
          return run;
        });
      }
      // Data reads in flight, and when the last one ended: a capture waits until the page's data has arrived and drawn.
      const reads = new Set<unknown>(), pageOrigin = new URL(req.url).origin;
      let lastRead = 0;
      page.on('request', request => { if (isDataRead(request.url(), pageOrigin)) reads.add(request); });
      const ended = (request: unknown) => { if (reads.delete(request)) lastRead = Date.now(); };
      page.on('requestfinished', ended); page.on('requestfailed', ended);
      await page.goto(req.url, { waitUntil: 'load', timeout }).catch((e) => { throw deadlineElapsed(e) ? new Error('Render deadline') : new NavigationError((e as Error).message); });
      if (req.injectCss) await page.addStyleTag({ content: req.injectCss }).catch(() => {});
      const surface = page.locator(req.selector).first();
      // A slide capture counts what the page drew. A deck whose script drew no slide leaves an empty body (its fixed
      // chrome takes no height), which never becomes visible: waiting for that spent the whole deadline and answered
      // `failed`, where the answer is no_slide with a count of 0.
      const slideCapture = 'capture' in req && typeof req.capture === 'object' && req.capture !== null && 'slide' in req.capture && !!req.capture.slide;
      await surface.waitFor({ timeout, state: slideCapture ? 'attached' : 'visible' });
      await page.waitForTimeout(req.settleMs ?? DEFAULT_SETTLE_MS);
      // A page drawn from its data (sql, GraphQL, functions) is ready once no read is in flight and the last one ended a
      // moment ago. A read that never ends runs into the deadline: a failed render, never an image without its data.
      for (;;) {
        const wait = reads.size ? DATA_QUIET_MS : lastRead + DATA_QUIET_MS - Date.now();
        if (wait <= 0) break;
        await page.waitForTimeout(Math.min(wait, remaining()));
        remaining();
      }
      // Readiness covers lazy placeholders and Vega's asynchronous work. Two
      // frames ensure an app handoff cannot expose a transient empty state.
      const waitForCharts=async()=>{
        for(;;){
          // Playwright treats a returned Promise as truthy; the polled predicate
          // must be synchronous. Await animation frames separately, then recheck.
          await page.waitForFunction(chartsSettled,req.selector,{timeout:remaining()});
          await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
          if(await page.evaluate(chartsSettled,req.selector))return;
          remaining();
        }
      };
      await waitForCharts();
      return await use({ page, surface, timeout, remaining, waitForCharts });
    } catch (error) {
      if (crashed) throw new RendererStopped(`the page was stopped: it used more than ${Math.round(o.limits.bytes / 1048576)} MB of memory or ${o.limits.threads} threads (each worker is one), or its renderer crashed`);
      throw error;
    } finally {
      forwarding.abort();
      await Promise.allSettled(pending);
      clearTimeout(renderTimer);
      if (context) await (deadlineClose ?? closePage(context, lease.browser));
      unwatch();
      await egress?.close();
      lease.release();
    }
  }

  let chain: Promise<unknown> = Promise.resolve();
  return {
    queue(job) { const run = chain.then(job); chain = run.catch(() => {}); return run; },
    readyPage,
    async warm(timeoutMs) { (await holder.acquire(timeoutMs)).release(); },
    close: () => holder.close(),
  };
}
