/**
 * THE QUERY IMAGE'S THREAD (./chart-image.server.ts): loads the grammar engines and sharp once,
 * registers the image fonts, then draws one job at a time (./chart-draw.server.ts) and answers `{id, result}`, the PNG's
 * bytes transferred. Everything it receives is data its parent already checked; its parent's
 * deadline terminates it, so nothing here times itself. Bundled beside the server as
 * `chart-image-worker.mjs` (scripts/build/build-server.mjs); in development
 * ./chart-image-worker-dev.mjs loads this source.
 */
import { parentPort } from 'node:worker_threads';
import { drawChart, type ChartDrawJob } from './chart-draw.server';
import { registerImageFonts } from './chart-fonts.server';

parentPort!.on('message', async ({ id, job }: { id: number; job: ChartDrawJob }) => {
  try {
    const result = await drawChart(job);
    if (result.ok) parentPort!.postMessage({ id, result }, [result.png.buffer as ArrayBuffer]);
    else parentPort!.postMessage({ id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    parentPort!.postMessage({ id, result: { ok: false, status: 400, code: 'invalid_chart', message: `the chart could not be drawn: ${message}`.slice(0, 500) } });
  }
});
// Faces first (./chart-fonts.server.ts): a thread without them still draws, in system families.
await registerImageFonts().catch(() => 0);
parentPort!.postMessage({ ready: true });
