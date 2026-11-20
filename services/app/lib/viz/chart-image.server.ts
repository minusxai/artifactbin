/**
 * THE QUERY IMAGE: a chart description (what <af-chart> takes) and the caller's own rows → one PNG,
 * for `POST /api/charts/image` (`render_chart_image`) and the identity owner's relay seam
 * (`CANONICAL_CHART_IMAGE_PATH`). Rendering reads no data: the rows are the caller's, so the only
 * checks are bounds on untrusted input.
 *
 * Bounds: the description per CHART_LIMITS (parseChartDescription, which refuses every `url`), at
 * most CHART_IMAGE_LIMITS.rows rows of plain objects, a box of 160–1600 × 120–1200 pixels (default
 * 640 × 400), and a PNG of at most contracts ARTIFACT_IMAGE_BYTES, so its base64 in a JSON answer
 * fits SERVICE_PAYLOAD_LIMIT, the bound its routes also put on request bodies.
 *
 * Drawing runs in ONE worker thread (./chart-image-worker.ts → ./chart-draw.server.ts), never on
 * the event loop: one job at a time, a few more waiting (past that 503 `render_busy`), each with a
 * hard deadline from the moment the started thread takes it (5 s; past it the thread is terminated
 * and replaced, 504 `render_timeout`). Startup has its own bound. A thread that dies mid-job (out of
 * memory) answers 422 `render_failed`; no thread entry at all is 503 `render_unavailable`, never an
 * in-process fallback.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { parseChartDescription } from '@/lib/html-component-specs/chart-spec';
import { ARTIFACT_IMAGE_BYTES, type ChartImageWire } from '@artifactbin/contracts';
import type { ChartDrawJob, ChartDrawResult } from './chart-draw.server';

export const CHART_IMAGE_LIMITS = {
  rows: 5_000, width: { min: 160, max: 1600, default: 640 }, height: { min: 120, max: 1200, default: 400 },
  pngBytes: ARTIFACT_IMAGE_BYTES,
} as const;

/** The design systems a caller can draw in (lib/html-systems server entry `DESIGN_SYSTEM_VARIABLES`). */
export interface ChartSystems {
  names: readonly string[];
  defaultMode(name: string): 'light' | 'dark';
  variables(name: string, mode: 'light' | 'dark'): Readonly<Record<string, string>> | null;
  /** True for a system without dark values: its charts draw light whatever `theme` asks. */
  lightOnly?(name: string): boolean;
}
type ChartImageResult = Extract<ChartDrawResult, { ok: false }> | { ok: true; png: Buffer; width: number; height: number };

interface RendererOptions { renderMs: number; startMs: number; waiting: number; maxPngBytes: number; workerUrl?: URL }
const DEFAULTS: RendererOptions = { renderMs: 5_000, startMs: 30_000, waiting: 4, maxPngBytes: CHART_IMAGE_LIMITS.pngBytes };
let options: RendererOptions = { ...DEFAULTS };

const refusal = (status: number, code: string, message: string, hint?: string): ChartImageResult =>
  ({ ok: false, status, code, message, ...(hint ? { hint } : {}) });
const isRow = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v);

/** The checked job, or the refusal of the first bad field. */
function admit(input: Record<string, unknown>, systems?: ChartSystems): ChartDrawJob | ChartImageResult {
  const parsed = parseChartDescription(input.chart);
  if (!parsed.ok) return refusal(400, 'invalid_chart', parsed.error);
  const rows = input.rows;
  if (!Array.isArray(rows) || !rows.every(isRow)) return refusal(400, 'invalid_request', 'rows is an array of row objects');
  if (rows.length > CHART_IMAGE_LIMITS.rows) {
    return refusal(413, 'too_large', `${rows.length} rows, past ${CHART_IMAGE_LIMITS.rows}`, 'aggregate in SQL to fewer rows');
  }
  const dimension = (key: 'width' | 'height') => {
    const { min, max, default: fallback } = CHART_IMAGE_LIMITS[key], value = input[key];
    if (value === undefined || value === null) return fallback;
    return Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : null;
  };
  const width = dimension('width'), height = dimension('height');
  if (width === null || height === null) {
    const { width: w, height: h } = CHART_IMAGE_LIMITS;
    return refusal(400, 'invalid_request', `width is a whole number of pixels from ${w.min} to ${w.max} and height from ${h.min} to ${h.max}`);
  }
  const theme = input.theme ?? null, system = input.designSystem ?? null;
  if (theme !== null && theme !== 'light' && theme !== 'dark') return refusal(400, 'invalid_request', 'theme is light or dark');
  if (system !== null && (typeof system !== 'string' || !systems?.names.includes(system))) {
    return refusal(400, 'invalid_request', `designSystem is one of ${systems?.names.join(', ') || '(none here)'}`);
  }
  const mode = (system && systems!.lightOnly?.(system) ? 'light' : theme ?? (system ? systems!.defaultMode(system) : 'light')) as 'light' | 'dark';
  return { description: parsed.value, rows, width, height, mode, variables: system ? systems!.variables(system, mode) : null,
    maxPngBytes: options.maxPngBytes };
}

/* ───────────────────────── the one drawing thread ───────────────────────── */

interface Thread { worker: Worker; ready: Promise<void> }
let thread: Thread | null = null;
let busy = false, ids = 0;
const queue: (() => void)[] = [];

/** The bundled thread beside the server bundle, else the source under tsx (development, tests); null for neither. */
function entry(): { url: URL; execArgv?: string[] } | null {
  if (options.workerUrl) return { url: options.workerUrl };
  const bundled = new URL('./chart-image-worker.mjs', import.meta.url);
  if (existsSync(fileURLToPath(bundled))) return { url: bundled };
  const source = new URL('./chart-image-worker-dev.mjs', import.meta.url);
  return existsSync(fileURLToPath(source)) ? { url: source, execArgv: [] } : null;
}

function spawn(): Thread | null {
  const found = entry();
  if (!found) return null;
  const worker = new Worker(found.url, { ...(found.execArgv ? { execArgv: found.execArgv } : {}),
    resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 } });
  worker.unref();
  const ready = new Promise<void>((resolve, reject) => {
    const onMessage = (m: unknown) => { if ((m as { ready?: boolean })?.ready) { worker.off('message', onMessage); resolve(); } };
    worker.on('message', onMessage);
    worker.once('error', reject);
    worker.once('exit', () => reject(new Error('the chart renderer stopped')));
  });
  ready.catch(() => {});
  // A thread failing between jobs is replaced at the next job.
  worker.on('error', () => { if (thread?.worker === worker) thread = null; });
  worker.on('exit', () => { if (thread?.worker === worker) thread = null; });
  return { worker, ready };
}

async function retire(t: Thread): Promise<void> {
  if (thread === t) thread = null;
  await t.worker.terminate().catch(() => {});
}

const within = <T>(work: Promise<T>, ms: number) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout')), ms);
  work.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
});

async function draw(job: ChartDrawJob): Promise<ChartImageResult> {
  const t = thread ??= spawn();
  if (!t) return refusal(503, 'render_unavailable', 'this server has no chart renderer thread');
  try { await within(t.ready, options.startMs); } catch {
    await retire(t);
    return refusal(503, 'render_unavailable', 'the chart renderer did not start; retry shortly');
  }
  const id = ++ids;
  return new Promise<ChartImageResult>((resolve) => {
    const settle = (result: ChartImageResult, stop = false) => {
      clearTimeout(timer);
      t.worker.off('message', onMessage).off('error', onError).off('exit', onExit);
      if (!stop) return resolve(result);
      // Replace the thread before answering, so a new one is warming while the next job waits.
      void retire(t).then(() => { thread ??= spawn(); resolve(result); });
    };
    const onMessage = (m: { id?: number; result?: ChartDrawResult }) => {
      if (m?.id !== id || !m.result) return;
      const r = m.result;
      settle(r.ok ? { ok: true, png: Buffer.from(r.png.buffer, r.png.byteOffset, r.png.byteLength), width: r.width, height: r.height } : r);
    };
    const failed = () => refusal(422, 'render_failed', 'drawing the chart exhausted the renderer',
      'draw fewer marks: aggregate the rows in SQL, or simplify the spec');
    const onError = () => settle(failed(), true);
    const onExit = () => settle(failed(), true);
    const timer = setTimeout(() => settle(refusal(504, 'render_timeout', `the chart took longer than ${options.renderMs} ms to draw`,
      'draw fewer marks or simpler transforms'), true), options.renderMs);
    t.worker.on('message', onMessage).once('error', onError).once('exit', onExit);
    t.worker.postMessage({ id, job });
  });
}

/** Draw one chart: the PNG and its pixel size, or a refusal with its HTTP status. */
export async function renderChartImage(input: Record<string, unknown>, systems?: ChartSystems): Promise<ChartImageResult> {
  const job = admit(input, systems);
  if ('ok' in job) return job;
  if (busy) {
    if (queue.length >= options.waiting) return refusal(503, 'render_busy', 'the chart renderer is busy', 'retry in a few seconds');
    await new Promise<void>(resolve => queue.push(resolve));
  }
  busy = true;
  try { return await draw(job); } finally {
    const next = queue.shift();
    if (next) next(); else busy = false;
  }
}

/** The JSON answer both doors send: `ChartImageWire` (contracts) or `{error, message, hint?}`. */
export async function chartImageAnswer(input: Record<string, unknown>, systems?: ChartSystems): Promise<{ status: number; body: Record<string, unknown> }> {
  const result = await renderChartImage(input, systems);
  if (!result.ok) return { status: result.status, body: { error: result.code, message: result.message, ...(result.hint ? { hint: result.hint } : {}) } };
  const wire: ChartImageWire = { mime: 'image/png', width: result.width, height: result.height, bytes: result.png.length,
    data: result.png.toString('base64') };
  return { status: 200, body: { ...wire } };
}

/** Tests only: change the deadlines, queue, PNG cap or thread entry; null restores the defaults and stops the thread. */
export async function configureChartRenderer(next: Partial<RendererOptions> | null): Promise<void> {
  const restart = !next || next.workerUrl !== options.workerUrl;
  options = next ? { ...options, ...next } : { ...DEFAULTS };
  if (restart && thread) await retire(thread);
}
