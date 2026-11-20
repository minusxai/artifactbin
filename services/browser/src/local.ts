export { sessionEnvNamesRead, sessionProcessPaths } from './session-config';
export { chromiumEnv, requestOriginAllowed } from './render-lane';
/**
 * CHROMIUM, IN THIS PROCESS. The only entry of this package that loads
 * Playwright; import it from a composition root only. TWO browsers (./render-lane,
 * each launched on first use and closed after a minute idle): one draws exports
 * (render, upload, harvest: ./page-capture), the other checks (inspect:
 * ./page-inspection), so no check ever waits on or delays an export, and a check
 * browser that is wedged or replaced never fails an export in flight. Each
 * lane is SERIALISED (one page at a time bounds memory); the check lane admits
 * a bounded few by ./check-admission. A render's deadline closes its own page
 * (its own context), never the browser. Every page is behind its own egress
 * proxy (./egress), with only the environment Chromium needs, and, when
 * BROWSER__RENDER_SANDBOX=chromium, inside Chromium's own sandbox
 * (./session-config renderSandboxChoice). Its renderers are held to
 * ./render-limits.
 */
import type { Browser } from 'playwright';
import sharp from 'sharp';
import type { BrowserService, BrowserSessions, HarvestedSvg, PageInspection, RenderResult, SvgHarvestResult } from '@artifactbin/contracts';
import { SVG_HARVEST_LIMITS } from '@artifactbin/contracts';
import { createBrowserSessions } from './sessions';
import { createSessionProcess } from './session-process';
import { renderSandboxChoice, type BrowserSessionOptions, type RenderSandboxChoice } from './session-config';
import { admittedUploadUrl, uploadImage, type UploadOptions } from './upload';
import { browserUploadOptions } from './upload-config';
import { BrowserUnavailable } from './browser-holder';
import { CHECK_LANE, createCheckAdmission } from './check-admission';
import { RENDER_LIMITS, type RenderLimits } from './render-limits';
import { DEFAULT_TIMEOUT_MS, NavigationError, createRenderLane } from './render-lane';
import { NoElementError, NoSlideError, captureOf, harvestDrawings } from './page-capture';
import { inspectOnce } from './page-inspection';

/** A page operation's failure, as its verdict: never reached (`navigation`), no browser (`unavailable`), else `failed`. */
const failure = (e: unknown) => e instanceof NavigationError ? { ok: false as const, reason: 'navigation' as const, detail: e.message }
  : e instanceof BrowserUnavailable ? { ok: false as const, reason: 'unavailable' as const, detail: e.message }
  : { ok: false as const, reason: 'failed' as const, detail: (e as Error).message };

/**
 * `launch` replaces Playwright's own launch (and so ignores `executablePath`, the sandbox and the egress launch); tests
 * count and hold browsers with it. `sandbox` defaults to BROWSER__RENDER_SANDBOX; `limits` to RENDER_LIMITS.
 */
export function createBrowser(opts: { idleShutdownMs?: number; executablePath?: () => Promise<string>; launch?: (timeoutMs: number) => Promise<Browser>; sessions?: BrowserSessionOptions; upload?:UploadOptions; sandbox?: RenderSandboxChoice; limits?: Partial<RenderLimits> } = {}): BrowserService & { close(): Promise<void>; start(): Promise<void> } {
  const upload=opts.upload??browserUploadOptions(process.env);
  const sandbox = opts.sandbox ?? renderSandboxChoice(process.env);
  const limits: RenderLimits = { ...RENDER_LIMITS, ...opts.limits };
  if (sandbox.mode === 'warn') console.warn('[browser] WARNING: renders run Chromium WITHOUT its sandbox (BROWSER__RENDER_SANDBOX is unset). Set BROWSER__RENDER_SANDBOX=chromium where the host allows unprivileged user namespaces (SETUP.md), or =none to accept running unsandboxed.');
  let executablePath: string | undefined;
  const laneOptions = { idleMs: opts.idleShutdownMs ?? 60_000, ...(opts.launch ? { launch: opts.launch } : {}), sandbox, limits, executablePath: () => executablePath };
  const exportsLane = createRenderLane('exports', laneOptions), checksLane = createRenderLane('checks', laneOptions);
  const admission = createCheckAdmission();
  /** Chromium's path, looked up again before each operation; a lookup that fails is the operation's `unavailable`. */
  const located = async () => {
    if (!opts.executablePath) return null;
    try { executablePath = await opts.executablePath(); return null; } catch (error) { return { ok: false as const, reason: 'unavailable' as const, detail: (error as Error).message }; }
  };

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
  const service:BrowserService & {close():Promise<void>;start():Promise<void>} = {
    sessions,
    async render(req): Promise<RenderResult> {
      const missing = await located(); if (missing) return missing;
      const deadline=Date.now()+(req.timeoutMs??DEFAULT_TIMEOUT_MS);
      return exportsLane.queue(() => {
        const remaining=deadline-Date.now();if(remaining<=0)throw new Error("Render timed out in queue");
        const shot = captureOf({ ...req, timeoutMs: remaining });
        return exportsLane.readyPage({ ...req, timeoutMs: remaining }, shot.density, shot.take);
      }).then(
        (r): RenderResult => Date.now()>deadline ? {ok:false,reason:'failed',detail:'Render deadline'} : { ok: true, ...r, ...(typeof req.capture === 'object' && 'element' in req.capture ? { element: true as const } : {}) },
        (e): RenderResult => e instanceof NoSlideError ? { ok: false, reason: 'no_slide', slides: e.slides } : e instanceof NoElementError ? e.verdict : failure(e),
      );
    },
    /**
     * THE DRAWINGS, AS TEXT (SvgHarvestRequest): the same ready page a render
     * photographs, on the same serialized chain and deadline, loaded `loads`
     * times in fresh pages; each load's drawings are bounded.
     */
    async harvestSvg(req): Promise<SvgHarvestResult> {
      const missing = await located(); if (missing) return missing;
      const loads = Math.min(Math.max(Math.trunc(req.loads ?? 1), 1), SVG_HARVEST_LIMITS.loads);
      const deadline=Date.now()+(req.timeoutMs??DEFAULT_TIMEOUT_MS);
      return exportsLane.queue(async () => {
        const answers: HarvestedSvg[][] = [];
        for (let load = 0; load < loads; load++) {
          const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Harvest timed out in queue');
          const once = { ...req, timeoutMs: remaining };
          answers.push(await exportsLane.readyPage(once, 1, (ready) => harvestDrawings(once, ready)));
        }
        return answers;
      }).then(
        (answers): SvgHarvestResult => Date.now()>deadline ? {ok:false,reason:'failed',detail:'Harvest deadline'} : { ok: true, loads: answers },
        failure,
      );
    },
    /**
     * THE PAGE'S OWN PROBLEMS (PageInspectRequest): the same ready page, in the check browser, on its own serialized
     * chain and deadline, admitted first by its charges and the lane's room (./check-admission): `busy` or
     * `rate_limited` at once, never a queue past CHECK_LANE.
     */
    async inspect(req): Promise<PageInspection> {
      const missing = await located(); if (missing) return missing;
      const deadline=Date.now()+(req.timeoutMs??DEFAULT_TIMEOUT_MS);
      const admitted = admission.admit(Array.isArray(req.charge) ? req.charge : []);
      if (admitted === 'busy') return { ok: false, reason: 'busy', detail: `at most ${CHECK_LANE.running} check runs and ${CHECK_LANE.waiting} wait, and one of each caller's` };
      if (admitted === 'rate_limited') return { ok: false, reason: 'rate_limited' };
      return checksLane.queue(async () => {
        try {
          const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Inspect timed out in queue');
          return await inspectOnce(checksLane, {...req,timeoutMs:remaining});
        } finally { admitted.release(); }
      }).then((found): PageInspection => ({ ok: true, ...found }), failure);
    },
    /**
     * Ready to render, or why not: with BROWSER__RENDER_SANDBOX=chromium the export browser is launched once inside
     * its sandbox, and a host that cannot give it one is refused here, at boot, by name (never a silent fallback).
     */
    async start() {
      if (sandbox.mode !== 'chromium') return;
      if(opts.executablePath)executablePath=await opts.executablePath();
      try { await exportsLane.warm(30_000); }
      catch (error) { throw new Error(`BROWSER__RENDER_SANDBOX=chromium, but Chromium could not start inside its sandbox (${(error as Error).message.split('\n')[0]}). The host must allow unprivileged user namespaces (SETUP.md, "On a server"); set BROWSER__RENDER_SANDBOX=none to accept rendering without it.`); }
    },
    async close() { await sessions.close(); await Promise.all([exportsLane.close(), checksLane.close()]); },
  };
  if(upload)service.renderAndUpload=async request=>{
    try{
      admittedUploadUrl(request.upload.url,upload);
      const deadline=Date.now()+(request.render.timeoutMs??DEFAULT_TIMEOUT_MS);
      if(request.upload.contentType!==(request.render.format==='jpg'?'image/jpeg':'image/png'))throw new Error('Mismatched upload format');
      const result=await service.render(request.render);if(!result.ok)return result;
      const metadata=await sharp(result.bytes).metadata();
      await uploadImage(request.upload,result.bytes,upload,deadline-Date.now());
      return {ok:true,mime:result.mime,bytes:result.bytes.byteLength,width:metadata.width!,height:metadata.height!,...(result.element?{element:true as const}:{})};
    }catch{return {ok:false,reason:'failed',detail:'Export upload failed'};}
  };
  return service;
}
