/**
 * The lazy chart module (lib/islands/chart `loadChart`, contract `IslandChartModule`): nothing loads
 * the controller chunk (Vega, lib/viz) until the first call; one chunk per page; a failed fetch is
 * retried; boot hands the loader to every island as `IslandContext.loadChart`.
 */
import { describe, expect, it, vi } from 'vitest';
import type { IslandChartInput } from '../contract';

const controller = vi.hoisted(() => ({ loaded: 0, fail: false, mounts: [] as IslandChartInput[] }));
vi.mock('../chart-controller', () => {
  controller.loaded++;
  if (controller.fail) throw new Error('chunk unavailable');
  return {
    mountChart: (input: IslandChartInput) => {
      controller.mounts.push(input);
      return { update: vi.fn(), destroy: vi.fn() };
    },
  };
});

describe('loadChart', () => {
  it('imports the controller on the first call only and hands it to islands through the context', async () => {
    const { loadChart } = await import('../chart');
    const { boot } = await import('../boot');
    expect(controller.loaded, 'importing the door and boot loads no controller').toBe(0);

    const module = await loadChart();
    expect(controller.loaded).toBe(1);
    const element = document.createElement('div');
    const chart = module.mountChart({ element, envelope: { version: 2 } as never, rows: [{ n: 1 }] });
    expect(controller.mounts).toEqual([{ element, envelope: { version: 2 }, rows: [{ n: 1 }] }]);
    chart.update?.([{ n: 2 }]);
    chart.destroy();
    expect(chart.destroy).toHaveBeenCalledTimes(1);

    expect(await loadChart()).toBe(module);
    expect(controller.loaded, 'one chunk per page').toBe(1);

    document.body.innerHTML = '<div data-mx-inline-story=""></div>';
    const doc = boot({ ISLANDS: [] });
    expect(await doc.context.loadChart()).toBe(module);
    doc.dispose();
  });
});

describe('the default runtime without a loader (the SSR render)', () => {
  it('refuses to draw rather than loading Vega', async () => {
    const { createIslandRuntime } = await import('../rt');
    const { createDataflowStore } = await import('@/lib/page-store/store');
    const rt = createIslandRuntime({}, (df) => createDataflowStore(df));
    await expect(rt.context.loadChart()).rejects.toThrow(/browser/);
  });
});
