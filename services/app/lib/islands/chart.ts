/**
 * THE LAZY CHART MODULE. A `<Question>` island's drawing box arrives drawn by the server (the
 * assembler finds it by `data-mx-chart-slot`, its handle only — the island removes the attribute on
 * mount); Vega loads in the browser only when the chart must be drawn here — its table changed
 * since the drawing, or the reader interacts (docs/phase2-architecture.md §2.4). `loadChart` imports
 * the controller chunk (chart-controller.ts: Vega and lib/viz) on the first call, once per page;
 * nothing here imports Vega statically. Islands reach it as `IslandContext.loadChart` (boot injects it).
 */
import type { DrawnChart } from '@/lib/compiled-page/contract';
import type { IslandChartModule } from './contract';
import { rowsDigest } from './digest';

let controller: Promise<IslandChartModule> | null = null;

export function loadChart(): Promise<IslandChartModule> {
  controller ??= import('./chart-controller').catch((error: unknown) => {
    controller = null; // a failed chunk fetch is retried by the next chart, not cached
    throw error;
  });
  return controller;
}

/** Whether the server's drawing is of exactly these rows (same digest), so the island keeps it and loads no Vega. */
export async function drawingIsCurrent(drawing: DrawnChart | null | undefined, rows: readonly Record<string, unknown>[]): Promise<boolean> {
  return !!drawing && drawing.rows === (await rowsDigest(rows));
}
