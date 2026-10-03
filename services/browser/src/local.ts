export { sessionEnvNamesRead, sessionProcessPaths } from './session-config';
import { createBrowserSessions } from './sessions';
import { createSessionProcess } from './session-process';
import type { BrowserSessionOptions } from './session-config';
/**
 * CHROMIUM, IN THIS PROCESS. The only entry of this package that loads
 * Playwright; import it from a composition root only. One browser, launched
 * on first use, closed after a minute idle; renders are SERIALISED — one page
 * at a time bounds memory, and a failed launch never poisons the next try.
 */
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import sharp from 'sharp';
import {admittedUploadUrl,uploadImage,type UploadOptions} from './upload';
import {browserUploadOptions} from './upload-config';
import type { BrowserService, BrowserSessions, HarvestedSvg, PageRequest, RenderRequest, RenderResult, SvgHarvestRequest, SvgHarvestResult } from '@artifactbin/contracts';
import { SVG_HARVEST_LIMITS } from '@artifactbin/contracts';
import { internalAssetResponse } from './internal-assets';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SETTLE_MS = 1_500;
// The editor can display the overview at ~850 CSS px on a 2x screen. Keeping
// canonical horizontal resolution avoids enlarging a thumbnail while the
// height cap still bounds unusually tall documents.
const PREVIEW_WIDTH = 1_600;
const PREVIEW_MAX_HEIGHT = 4_096;

class NavigationError extends Error {}
class NoSlideError extends Error { constructor(readonly slides: number) { super(`document has ${slides} slides`); } }

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function requestOriginAllowed(target:string,pageOrigin:string,allowedOrigins:string[]=[]):boolean {
  if(target.startsWith('data:')||target.startsWith('blob:'))return true;
  try{return new Set([pageOrigin,...allowedOrigins]).has(new URL(target).origin);}catch{return false;}
}

/** Serialized into Chromium: keep this predicate synchronous and self-contained. */
function chartsSettled(selector:string):boolean {
 const root=document.querySelector(selector);
 return !!root&&!root.matches('[data-mx-chart-state="pending"]')&&!root.querySelector('[data-mx-chart-state="pending"]');
}

/**
 * Serialized into Chromium BEFORE the page's own scripts (an init script): which script component mounts the page has
 * rendered. The page runtime (app lib/islands/page-runtime) takes a mount's server fallback out (`replaceChildren()`)
 * and renders the component in the same task, and the parser never removes a node, so a removal from a mount means it
 * was rendered; a mount whose children differ from the ones it had when parsing finished was rendered too (an empty
 * fallback). Self-contained, no nested named functions.
 */
function watchMounts(): void {
  const state = { taken: new WeakSet<Element>(), parsed: new WeakMap<Element, Node[]>() };
  (window as unknown as { __mxMounts: typeof state }).__mxMounts = state;
  new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target as Element;
      if (record.removedNodes.length && target.nodeType === 1 && target.hasAttribute('data-mx-mount')) state.taken.add(target);
    }
  }).observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => {
    for (const mount of document.querySelectorAll('[data-mx-mount]')) state.parsed.set(mount, [...mount.childNodes]);
  });
}

/** Serialized into Chromium: every mount under the surface rendered (see watchMounts). Synchronous. */
function mountsRendered(selector: string): boolean {
  const root = document.querySelector(selector);
  const state = (window as unknown as { __mxMounts?: { taken: WeakSet<Element>; parsed: WeakMap<Element, Node[]> } }).__mxMounts;
  if (!root || !state) return true;
  return [...root.querySelectorAll('[data-mx-mount]')].every((mount) => {
    if (state.taken.has(mount)) return true;
    const parsed = state.parsed.get(mount);
    return !!parsed && (parsed.length !== mount.childNodes.length || parsed.some((node, i) => node !== mount.childNodes[i]));
  });
}

/**
 * Serialized into Chromium: every `collect` element under the surface whose
 * `<img>` holds an SVG `data:` URL — its own `data-*` attributes, the image's
 * width/height attributes and the URL. Self-contained, synchronous, and with
 * no nested function: a bundler's name-keeping helper would not exist there.
 */
function collectDrawings(input: { selector: string; collect: string; limit: number }) {
  const root = document.querySelector(input.selector);
  if (!root) return [];
  const out: Array<{ attributes: Record<string, string>; width: number | null; height: number | null; src: string }> = [];
  for (const element of root.querySelectorAll(input.collect)) {
    const img = element.querySelector('img');
    const src = img?.getAttribute('src') ?? '';
    if (!img || !src.startsWith('data:image/svg+xml')) continue;
    const attributes: Record<string, string> = {};
    for (const attribute of element.attributes) if (attribute.name.startsWith('data-')) attributes[attribute.name] = attribute.value.slice(0, 512);
    const width = Number(img.getAttribute('width')), height = Number(img.getAttribute('height'));
    out.push({ attributes, width: img.hasAttribute('width') && Number.isFinite(width) ? width : null, height: img.hasAttribute('height') && Number.isFinite(height) ? height : null, src });
    if (out.length >= input.limit) break;
  }
  return out;
}

/** The SVG text of an `image/svg+xml` data URL (percent-encoded or base64). */
export function svgFromDataUrl(src: string): string {
  const comma = src.indexOf(',');
  const head = src.slice(0, comma);
  if (comma < 0 || !/^data:image\/svg\+xml(;charset=utf-8)?(;base64)?$/i.test(head)) throw new Error('Not an SVG data URL');
  const body = src.slice(comma + 1);
  return head.toLowerCase().endsWith(';base64') ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body);
}

export function createBrowser(opts: { idleShutdownMs?: number; executablePath?: () => Promise<string>; sessions?: BrowserSessionOptions; upload?:UploadOptions } = {}): BrowserService & { close(): Promise<void> } {
  const idleMs = opts.idleShutdownMs ?? 60_000;
  const upload=opts.upload??browserUploadOptions(process.env);
  let browser: Promise<Browser> | undefined;
  let executablePath: string | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  let idle: ReturnType<typeof setTimeout> | undefined;

  const get = (timeoutMs=DEFAULT_TIMEOUT_MS): Promise<Browser> => {
    if (!browser) {
      const p = chromium.launch({ headless: true, timeout:timeoutMs, ...(executablePath?{executablePath}:{}) }).catch((e) => { if (browser === p) browser = undefined; throw e; });
      browser = p;
    }
    return browser;
  };
  const close = async () => {
    const b = browser; browser = undefined;
    if (idle) clearTimeout(idle); idle = undefined;
    if (b) await b.then((x) => x.close()).catch(() => {});
  };
  const scheduleIdle = () => { if (idle) clearTimeout(idle); idle = setTimeout(() => void close(), idleMs); idle.unref?.(); };

  /**
   * ONE PAGE, LOADED AND SETTLED — what every operation that looks at a page
   * shares: the deadline, the per-request page with service workers blocked,
   * the context-wide admission/forwarding route, navigation, and every
   * readiness wait (diagrams, managed frames, the settle, charts). `use` sees
   * the ready page; the page is closed after, whatever happened.
   */
  async function withReadyPage<T>(req: PageRequest, deviceScaleFactor: number, use: (ready: { page: Page; surface: Locator; timeout: number; remaining: () => number; waitForCharts: () => Promise<void> }) => Promise<T>): Promise<T> {
    const deadline=Date.now()+(req.timeoutMs??DEFAULT_TIMEOUT_MS);
    const remaining=()=>{const ms=deadline-Date.now();if(ms<=0)throw new Error('Render deadline');return ms;};
    let b = await get(remaining());
    if (!b.isConnected()) { await close(); b = await get(remaining()); }
    const timeout = remaining();
    // reducedMotion: the motion kit never arms scroll reveals under it, so a capture always sees the finished page.
    let deadlineClose:Promise<void>|undefined;
    const renderTimer=setTimeout(()=>{deadlineClose=b.close().catch(()=>{});},remaining());
    const page = await b.newPage({ viewport: req.viewport, reducedMotion: 'reduce', deviceScaleFactor, serviceWorkers: 'block' }).catch(async error=>{clearTimeout(renderTimer);await deadlineClose;throw error;});
    const forwarding = new AbortController();
    const pending = new Set<Promise<void>>();
    try {
      if (req.sameOriginOnly || req.assetOrigin) {
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
              } else if (!req.sameOriginOnly || requestOriginAllowed(request.url(), origin, req.allowedOrigins)) await route.continue();
              else await route.abort();
            } catch { await route.abort().catch(() => {}); }
          })();
          pending.add(run); void run.finally(() => pending.delete(run));
          return run;
        });
      }
      if (req.waitForMountsMs) await page.addInitScript(watchMounts);
      await page.goto(req.url, { waitUntil: 'load', timeout }).catch((e) => { throw new NavigationError((e as Error).message); });
      if (req.injectCss) await page.addStyleTag({ content: req.injectCss }).catch(() => {});
      const surface = page.locator(req.selector).first();
      await surface.waitFor({ timeout });
      // SSR emits pending diagram markers before hydration. Wait through the
      // lazy engine and image decode; a handled syntax error is also settled.
      await page.waitForFunction(selector => {
        const root = document.querySelector(selector);
        return !!root && !root.matches('[data-mx-mermaid-state="pending"]') && !root.querySelector('[data-mx-mermaid-state="pending"]');
      }, req.selector, { timeout });
      if(req.waitForManagedFrames)await page.waitForFunction(selector=>{
        const root=document.querySelector(selector);if(!root)return false;
        return [...root.querySelectorAll('[data-mx-managed-frame]')].every(host=>host.querySelector('iframe[data-mx-author-ready]'));
      },req.selector,{timeout});
      // The page's script renders its components a moment after load; a mount still on its fallback at the cap is
      // photographed as it stands (never a failure: the fallback is a page, a component that never mounts is the author's).
      if (req.waitForMountsMs) await page.waitForFunction(mountsRendered, req.selector, { timeout: Math.min(req.waitForMountsMs, remaining()) }).catch(() => { remaining(); });
      await page.waitForTimeout(req.settleMs ?? DEFAULT_SETTLE_MS);
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
    } finally {
      forwarding.abort();
      await Promise.allSettled(pending);
      clearTimeout(renderTimer);
      await page.close().catch(() => {});
      await deadlineClose;
      scheduleIdle();
    }
  }

  async function shoot(req: RenderRequest): Promise<{ mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array }> {
    const requestedCrop = typeof req.capture === 'object' && 'card' in req.capture ? req.capture.card : null;
    // A crop narrower than the output must be RASTERIZED at the corresponding
    // density. Scaling a 637px screenshot to 1600px only enlarges its pixels.
    const cardDensity = requestedCrop
      ? clamp(req.viewport.width / Math.max(1, requestedCrop.width), 1, 4)
      : 1;
    return withReadyPage(req, cardDensity, async ({ page, surface, timeout, waitForCharts }) => {
      const shotOpts = { timeout, ...(req.format === 'jpg' ? { type: 'jpeg' as const, quality: req.quality ?? 85 } : { type: 'png' as const }) };
      const mime = req.format === 'jpg' ? 'image/jpeg' as const : 'image/png' as const;
      if (typeof req.capture === 'object' && 'slide' in req.capture) {
        const slides = surface.locator('[data-mx-slide]');
        const count = await slides.count();
        if (req.capture.slide > count) throw new NoSlideError(count);
        const one = slides.nth(req.capture.slide - 1);
        await one.scrollIntoViewIfNeeded({ timeout });
        await waitForCharts();
        return { mime, bytes: new Uint8Array(await one.screenshot(shotOpts)) };
      }
      if (req.capture === 'full') return { mime, bytes: new Uint8Array(await surface.screenshot(shotOpts)) };
      if (req.capture === 'preview' || typeof req.capture === 'object') {
        const { width: outputWidth, height: outputHeight } = req.viewport;
        const box = (await surface.boundingBox()) ?? { x: 0, y: 0, width: outputWidth, height: outputHeight };
        const crop = requestedCrop;
        const sourceWidth = crop
          ? clamp(crop.width, 1, Math.max(1, box.width))
          : Math.min(Math.max(1, box.width), outputWidth);
        const sourceHeight = crop
          ? sourceWidth * outputHeight / outputWidth
          : Math.max(1, box.height);
        const x = crop ? clamp(crop.x, 0, Math.max(0, box.width - sourceWidth)) : 0;
        const y = crop ? clamp(crop.y, 0, Math.max(0, box.height - sourceHeight)) : 0;
        if (crop) {
          // page.screenshot honors deviceScaleFactor; CDP clip.scale does not
          // increase raster density and produced a visibly enlarged bitmap.
          const initialScrollY = await page.evaluate(() => window.scrollY);
          const documentY = initialScrollY + box.y + y;
          await page.evaluate((top) => window.scrollTo(0, top), documentY);
          const scrollY = await page.evaluate(() => window.scrollY);
          await waitForCharts();
          const bytes = await page.screenshot({
            // Keep the high-density intermediate lossless. JPEG is encoded
            // once, after the fractional clip is normalized to exact output.
            type: 'png',
            timeout,
            clip: { x: box.x + x, y: documentY - scrollY, width: sourceWidth, height: sourceHeight },
          });
          // Fractional clip edges round at device pixels. The public contract
          // remains exact even when the chosen width is not a clean divisor.
          const exactPipeline = sharp(bytes).resize(outputWidth, outputHeight, { fit: 'fill' });
          const exact = req.format === 'jpg'
            ? await exactPipeline.jpeg({ quality: req.quality ?? 85 }).toBuffer()
            : await exactPipeline.png().toBuffer();
          return { mime, bytes: new Uint8Array(exact) };
        }
        const client = await page.context().newCDPSession(page);
        try {
          const scale = Math.min(PREVIEW_WIDTH / sourceWidth, PREVIEW_MAX_HEIGHT / sourceHeight);
          await waitForCharts();
          const captured = await client.send('Page.captureScreenshot', {
            format: req.format === 'jpg' ? 'jpeg' : 'png',
            ...(req.format === 'jpg' ? { quality: req.quality ?? 85 } : {}),
            fromSurface: true,
            captureBeyondViewport: true,
            clip: {
              x: box.x + x,
              y: box.y + y,
              width: sourceWidth,
              height: sourceHeight,
              scale,
            },
          });
          const bytes = Buffer.from(captured.data, 'base64');
          return { mime, bytes: new Uint8Array(bytes) };
        } finally {
          await client.detach().catch(() => {});
        }
      }
      // card: clip the PAGE to the surface's top stage; grow the viewport by the surface's offset so the clip is full height.
      const { width, height } = req.viewport;
      let box = (await surface.boundingBox()) ?? { x: 0, y: 0, width, height };
      await page.setViewportSize({ width, height: Math.ceil(box.y) + height });
      box = (await surface.boundingBox()) ?? box;
      await waitForCharts();
      const bytes = await page.screenshot({ clip: { x: box.x, y: box.y, width: Math.min(box.width, width) || width, height }, ...shotOpts });
      return { mime, bytes: new Uint8Array(bytes) };
    });
  }

  /** One load's drawings, bounded (SVG_HARVEST_LIMITS); the page is the ready page above. */
  async function harvestOnce(req: SvgHarvestRequest): Promise<HarvestedSvg[]> {
    return withReadyPage(req, 1, async ({ page }) => {
      const found = await page.evaluate(collectDrawings, { selector: req.selector, collect: req.collect, limit: SVG_HARVEST_LIMITS.images + 1 });
      if (found.length > SVG_HARVEST_LIMITS.images) throw new Error('Too many drawings');
      let total = 0;
      return found.map(({ attributes, width, height, src }) => {
        const svg = svgFromDataUrl(src);
        total += svg.length;
        if (svg.length > SVG_HARVEST_LIMITS.imageBytes || total > SVG_HARVEST_LIMITS.totalBytes) throw new Error('Drawings too large');
        return { attributes, width, height, svg };
      });
    });
  }

  const started = createBrowserSessions(actor => {
    if (!opts.sessions) throw new Error('Browser session forwarding is not configured');
    return createSessionProcess(actor, opts.sessions);
  }, opts.sessions?.capacity);
  /*
   * SAID OUT LOUD, TWICE. `BROWSER__SANDBOX=none` is a development escape hatch, so the
   * boot says so once in the log for whoever started this process, and every session
   * result carries `sandbox:'none'` for whoever is reading over HTTP — a gate asserting
   * OS containment must be able to see that there is none and skip those checks by name
   * instead of being rewritten into something weaker.
   */
  const unsandboxed = opts.sessions?.sandbox?.mode === 'none';
  if (unsandboxed) console.warn('[browser] BROWSER__SANDBOX=none — browser sessions run as plain child processes with NO OS containment (development only)');
  const sessions: BrowserSessions = unsandboxed
    ? { close: () => started.close(), async request(input) { return { ...await started.request(input), sandbox: 'none' }; } }
    : started;
  const service:BrowserService & {close():Promise<void>} = {
    sessions,
    async render(req): Promise<RenderResult> {
      if(opts.executablePath){try{executablePath=await opts.executablePath();}catch(error){return {ok:false,reason:'unavailable',detail:(error as Error).message};}}
      const deadline=Date.now()+(req.timeoutMs??DEFAULT_TIMEOUT_MS);
      const run = chain.then(() => {const remaining=deadline-Date.now();if(remaining<=0)throw new Error("Render timed out in queue");return shoot({...req,timeoutMs:remaining});}).then(
        (r): RenderResult => Date.now()>deadline ? {ok:false,reason:'failed',detail:'Render deadline'} : { ok: true, ...r },
        (e): RenderResult => {
          if (e instanceof NoSlideError) return { ok: false, reason: 'no_slide', slides: e.slides };
          if (e instanceof NavigationError) return { ok: false, reason: 'navigation', detail: e.message };
          if (!browser) return { ok: false, reason: 'unavailable', detail: (e as Error).message };
          return { ok: false, reason: 'failed', detail: (e as Error).message };
        },
      );
      chain = run;
      return run;
    },
    /**
     * THE DRAWINGS, AS TEXT (SvgHarvestRequest): the same ready page a render
     * photographs, on the same serialized chain and deadline, loaded `loads`
     * times in fresh pages; each load's drawings are bounded.
     */
    async harvestSvg(req): Promise<SvgHarvestResult> {
      if(opts.executablePath){try{executablePath=await opts.executablePath();}catch(error){return {ok:false,reason:'unavailable',detail:(error as Error).message};}}
      const loads = Math.min(Math.max(Math.trunc(req.loads ?? 1), 1), SVG_HARVEST_LIMITS.loads);
      const deadline=Date.now()+(req.timeoutMs??DEFAULT_TIMEOUT_MS);
      const run = chain.then(async () => {
        const answers: HarvestedSvg[][] = [];
        for (let load = 0; load < loads; load++) {
          const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Harvest timed out in queue');
          answers.push(await harvestOnce({ ...req, timeoutMs: remaining }));
        }
        return answers;
      }).then(
        (answers): SvgHarvestResult => Date.now()>deadline ? {ok:false,reason:'failed',detail:'Harvest deadline'} : { ok: true, loads: answers },
        (e): SvgHarvestResult => {
          if (e instanceof NavigationError) return { ok: false, reason: 'navigation', detail: e.message };
          if (!browser) return { ok: false, reason: 'unavailable', detail: (e as Error).message };
          return { ok: false, reason: 'failed', detail: (e as Error).message };
        },
      );
      chain = run;
      return run;
    },
    async close() { await sessions.close(); await close(); },
  };
  if(upload)service.renderAndUpload=async request=>{
    try{
      admittedUploadUrl(request.upload.url,upload);
      const deadline=Date.now()+(request.render.timeoutMs??DEFAULT_TIMEOUT_MS);
      if(request.upload.contentType!==(request.render.format==='jpg'?'image/jpeg':'image/png'))throw new Error('Mismatched upload format');
      const result=await service.render(request.render);if(!result.ok)return result;
      const metadata=await sharp(result.bytes).metadata();
      await uploadImage(request.upload,result.bytes,upload,deadline-Date.now());
      return {ok:true,mime:result.mime,bytes:result.bytes.byteLength,width:metadata.width!,height:metadata.height!};
    }catch{return {ok:false,reason:'failed',detail:'Export upload failed'};}
  };
  return service;
}
