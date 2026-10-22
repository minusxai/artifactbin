import { chartEnvelopeKey } from "./plan.ts";
import type {
  CompiledChartPlan,
  ChartRendererPorts,
  CompiledChartController,
} from "./contracts.ts";
/** Framework-free chart lifecycle injected into the archived kit's explicit loadChart port. */
export function createCompiledCharts(
  plans: readonly CompiledChartPlan[],
  ports: ChartRendererPorts,
) {
  const lookup = new Map(plans.map((plan) => [plan.key, plan]));
  if (lookup.size !== plans.length)
    throw Error("Duplicate compiled chart plan");
  return {
    mountChart(input: {
      element: HTMLElement;
      envelope: unknown;
      rows: Record<string, unknown>[];
    }): CompiledChartController {
      const plan = lookup.get(chartEnvelopeKey(input.envelope));
      if (!plan) throw Error("Chart envelope was not compiled offline");
      const element = input.element;
      const copyRows = (rows: Record<string, unknown>[]) => {
        if (!Array.isArray(rows) || rows.length > 10000)
          throw Error("Chart row limit exceeded");
        return JSON.parse(chartEnvelopeKey(rows)) as Record<string, unknown>[];
      };
      let pending = copyRows(input.rows);
      const view = ports.create(
        JSON.parse(JSON.stringify(plan.runtime)),
        element,
      );
      let disposed = false,
        running = false,
        dirty = true;
      const draw = async () => {
        if (disposed || running) return;
        running = true;
        try {
          while (dirty && !disposed) {
            dirty = false;
            element.setAttribute("data-mx-chart-state", "pending");
            view
              .data("main", pending)
              .width(
                Math.max(80, Math.min(4096, element.clientWidth || plan.width)),
              )
              .height(
                Math.max(
                  60,
                  Math.min(4096, element.clientHeight || plan.height),
                ),
              )
              .resize();
            await view.runAsync();
          }
          if (!disposed) {
            element.removeAttribute("data-mx-chart-error");
            element.setAttribute("data-mx-chart-state", "ready");
          }
        } catch {
          if (!disposed) {
            element.setAttribute(
              "data-mx-chart-error",
              "Chart rendering failed",
            );
            element.setAttribute("data-mx-chart-state", "error");
            element.setAttribute("aria-busy", "false");
          }
        } finally {
          running = false;
        }
      };
      let stop: () => void;
      try {
        stop = ports.observe(element, () => {
          dirty = true;
          void draw();
        });
      } catch (error) {
        view.finalize();
        throw error;
      }
      void draw();
      return {
        update(rows) {
          if (disposed) throw Error("Chart disposed");
          pending = copyRows(rows);
          dirty = true;
          void draw();
        },
        destroy() {
          if (disposed) return;
          disposed = true;
          try {
            stop();
          } finally {
            view.finalize();
          }
        },
      };
    },
  };
}
