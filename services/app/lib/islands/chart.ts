/**
 * THE LAZY CHART MODULE. A `<Question>` island's drawing box arrives drawn by the server (the
 * assembler finds it by `data-mx-chart-slot`, its handle only — the island removes the attribute on
 * mount); Vega loads in the browser after reader readiness when the chart becomes visible (or at
 * idle), when its table changes, or when the reader interacts. `loadChart` imports
 * the controller chunk (chart-controller.ts: Vega and lib/viz) on the first call, once per page;
 * nothing here imports Vega statically. Islands reach it as `IslandContext.loadChart` (boot injects it).
 */
import type { DrawnChart } from '@/lib/compiled-page/contract';
import type { IslandChartModule } from './contract';
import { rowsDigest } from './digest';

/**
 * The classes a server drawing's root `<svg>` carries (charts.server `drawChart`): out of flow and the
 * full size of its chart box, scaled by its viewBox. The box then has exactly the size the former reader
 * gives it — its own layout, never the drawing's nominal height — from the first paint, so nothing
 * moves when the island hydrates or when Vega later draws the chart at the box's size. Utilities of
 * the recipe base, so every reader sheet compiles them.
 */
export const DRAWING_CLASS = 'absolute inset-0 size-full';

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
