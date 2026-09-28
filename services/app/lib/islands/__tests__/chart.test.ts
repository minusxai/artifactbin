/**
 * The lazy chart door (lib/islands/chart): a handle at once, the controller chunk (Vega and lib/viz)
 * imported only on first mount, and calls made while it loads applied once it has.
 */
import { describe, expect, it, vi } from 'vitest';

const controller = vi.hoisted(() => ({ loaded: 0, mounts: [] as Array<{ el: HTMLElement; update: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> }));
vi.mock('../chart-controller', () => {
  controller.loaded++;
  return {
    mountChart: (el: HTMLElement) => {
      const handle = { el, update: vi.fn(), dispose: vi.fn() };
      controller.mounts.push(handle);
      return handle;
    },
  };
});

describe('mountChart', () => {
  it('imports the controller on first use only, then applies queued rows and dispose', async () => {
    const { mountChart, loadChartController } = await import('../chart');
    expect(controller.loaded, 'importing the door loads no controller').toBe(0);

    const el = document.createElement('div');
    const handle = mountChart(el, { envelope: {} as never, rows: [{ n: 1 }], colorMode: 'light' });
    handle.update([{ n: 2 }]);
    await loadChartController();
    await Promise.resolve();
    expect(controller.loaded).toBe(1);
    expect(controller.mounts).toHaveLength(1);
    expect(controller.mounts[0]!.update).toHaveBeenCalledWith([{ n: 2 }]);

    handle.update([{ n: 3 }]);
    expect(controller.mounts[0]!.update).toHaveBeenLastCalledWith([{ n: 3 }]);
    handle.dispose();
    expect(controller.mounts[0]!.dispose).toHaveBeenCalledTimes(1);

    const late = mountChart(document.createElement('div'), { envelope: {} as never, rows: [], colorMode: 'dark' });
    late.dispose();
    await loadChartController();
    await Promise.resolve();
    expect(controller.mounts, 'a chart disposed before the chunk arrived never mounts').toHaveLength(1);
    expect(controller.loaded, 'one chunk per page').toBe(1);
  });
});
