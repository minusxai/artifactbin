import { chartEnvelopeKey } from "./plan.ts";
import { matchChartTextPlan } from "./text-template.ts";
import type {
  CompiledChartPlan,
  ChartRendererPorts,
  CompiledChartController,
} from "./contracts.ts";
function showChartError(element: HTMLElement): void {
  element.setAttribute("data-mx-chart-error", "Chart rendering failed");
  element.setAttribute("data-mx-chart-state", "error");
  element.setAttribute("aria-busy", "false");
  element.setAttribute("role", "status");
  element.textContent =
    "Chart unavailable. Reload the page after checking its data.";
}
function unavailableChart(element: HTMLElement): CompiledChartController {
  showChartError(element);
  let stopped = false;
  return {
    update() {
      if (stopped) throw Error("Chart disposed");
    },
    destroy() {
      stopped = true;
    },
  };
}
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
      let plan = lookup.get(chartEnvelopeKey(input.envelope));
      let signals: ReturnType<typeof matchChartTextPlan> = null;
      if (!plan) {
        for (const candidate of plans) {
          const values = matchChartTextPlan(candidate, input.envelope);
          if (values) {
            if (plan) throw Error("Ambiguous compiled chart envelope");
            plan = candidate;
            signals = values;
          }
        }
      }
      if (!plan) {
        if (plans.some((candidate) => candidate.textBindings?.length))
          return unavailableChart(input.element);
        throw Error("Chart envelope was not compiled offline");
      }
      const selectedPlan = plan;
      const element = input.element;
      const copyRows = (rows: Record<string, unknown>[]) => {
        if (!Array.isArray(rows) || rows.length > 10000)
          throw Error("Chart row limit exceeded");
        return JSON.parse(chartEnvelopeKey(rows)) as Record<string, unknown>[];
      };
      const showError = () => {
        showChartError(element);
      };
      let pending: Record<string, unknown>[];
      try {
        pending = copyRows(input.rows);
      } catch {
        return unavailableChart(element);
      }

      const view = ports.create(
        JSON.parse(JSON.stringify(plan.runtime)),
        element,
      );
      if (signals) {
        if (!view.signal) {
          view.finalize();
          throw Error("Chart signal adapter unavailable");
        }
        for (const binding of signals)
          view.signal(binding.signal, binding.value);
      }
      let failed = false;
      let disposed = false,
        running = false,
        dirty = true;
      const draw = async () => {
        if (disposed || running || failed) return;
        running = true;
        try {
          while (dirty && !disposed) {
            dirty = false;
            element.setAttribute("data-mx-chart-state", "pending");
            view
              .data("main", pending)
              .width(
                Math.max(
                  80,
                  Math.min(4096, element.clientWidth || selectedPlan.width),
                ),
              )
              .height(
                Math.max(
                  60,
                  Math.min(4096, element.clientHeight || selectedPlan.height),
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
            failed = true;
            showError();
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
          try {
            pending = copyRows(rows);
          } catch {
            failed = true;
            showError();
            return;
          }
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
