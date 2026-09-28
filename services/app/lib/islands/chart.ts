/**
 * THE LAZY CHART DOOR. A `<Question>` island's chart slot (`data-mx-chart-slot`) arrives drawn by
 * the server; Vega loads in the browser only when the chart must be drawn here — its table changed
 * since the drawing, or the reader interacts (docs/phase2-architecture.md §2.4). `mountChart`
 * answers a handle at once and imports the controller chunk (chart-controller.ts, Vega and lib/viz)
 * on first use; nothing here imports Vega statically.
 */
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { DrawnChart } from '@/lib/compiled-page/contract';
import { rowsDigest } from './digest';

export type ChartRows = Record<string, unknown>[];

export interface ChartOptions {
  envelope: VizEnvelope;
  rows: ChartRows;
  colorMode: 'light' | 'dark';
  onError?(message: string): void;
}

export interface ChartController {
  /** New rows for the same spec: re-fed without a rebuild. */
  update(rows: ChartRows): void;
  dispose(): void;
}

let controller: Promise<typeof import('./chart-controller')> | null = null;
/** The controller chunk, fetched once per page. */
export const loadChartController = (): Promise<typeof import('./chart-controller')> => (controller ??= import('./chart-controller'));

/** Mount a chart into `el`; calls made before the controller has loaded are applied when it has. */
export function mountChart(el: HTMLElement, options: ChartOptions): ChartController {
  let rows: ChartRows | null = null;
  let disposed = false;
  let live: ChartController | null = null;
  loadChartController().then(
    ({ mountChart: mount }) => {
      if (disposed) return;
      live = mount(el, options);
      if (rows) live.update(rows);
    },
    (error: unknown) => options.onError?.(error instanceof Error ? error.message : String(error)),
  );
  return {
    update(next) { if (live) live.update(next); else rows = next; },
    dispose() { disposed = true; live?.dispose(); live = null; },
  };
}

/** Whether the server's drawing is of exactly these rows (same digest), so the island keeps it and loads no Vega. */
export async function drawingIsCurrent(drawing: DrawnChart | null | undefined, rows: readonly Record<string, unknown>[]): Promise<boolean> {
  return !!drawing && drawing.rows === (await rowsDigest(rows));
}
