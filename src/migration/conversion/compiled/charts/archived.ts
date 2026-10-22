import path from "node:path";
import { pathToFileURL } from "node:url";
import { compileChartPlan, isKitQuestionView } from "./plan.ts";
import type { CompiledChartPlan } from "./contracts.ts";
/** Called only inside the bounded archived compiler subprocess. Never import from page boot. */
export async function prepareArchivedChartPlans(
  nodes: readonly any[],
  archived: (relative: string) => Promise<any>,
  archivedRoot: string,
  options: {
    colorMode: "light" | "dark";
    tables?: Record<
      string,
      {
        columns: Array<{ name: string; type: string }>;
        rows: Record<string, unknown>[];
      }
    >;
  },
): Promise<CompiledChartPlan[]> {
  const [
    { questionEnvelope },
    { resolveEnvelopeSpec, planVega },
    { inferVizColumnsFromRows },
    { deepHasValueHole },
    { parse },
  ] = await Promise.all([
    archived("lib/viz/chart-envelope.ts"),
    archived("lib/viz/render-vega.ts"),
    archived("lib/viz/query-data.ts"),
    archived("lib/jsx/template.ts"),
    import(
      pathToFileURL(
        path.join(archivedRoot, "node_modules/vega/build/vega.module.js"),
      ).href
    ),
  ]);
  const plans = new Map<string, CompiledChartPlan>();
  const walk = (list: readonly any[]) => {
    for (const node of list) {
      if (node.type !== "element") continue;
      if (["Question", "Chart"].includes(node.tag)) {
        const attr = (name: string) =>
          node.attributes.find((a: any) => a.name === name)?.value;
        const vizAttr = attr("viz");
        if (vizAttr && !(vizAttr.static && isKitQuestionView(vizAttr.json))) {
          if (!vizAttr.static || deepHasValueHole(vizAttr.json))
            throw Error(
              "Templated chart requires a finite offline plan adapter",
            );
          const data = attr("data");
          if (
            !data?.static ||
            typeof data.json !== "string" ||
            !/^\$[A-Za-z][A-Za-z0-9_]*$/.test(data.json)
          )
            throw Error("Chart requires a declared data binding");
          const table = options.tables?.[data.json.slice(1)];
          const height = attr("height");
          const numericHeight =
            height?.static && typeof height.json === "number"
              ? height.json
              : 300;
          const plan = compileChartPlan(
            {
              viz: vizAttr.json,
              columns: table?.columns ?? [],
              rows: table?.rows ?? [],
              width: 640,
              height: numericHeight,
              colorMode: options.colorMode,
            },
            {
              envelope: questionEnvelope,
              resolve: resolveEnvelopeSpec,
              plan: planVega,
              infer: inferVizColumnsFromRows,
              parse,
            },
          );
          plans.set(plan.key, plan);
          if (plans.size > 32) throw Error("Chart count exceeds limit");
        }
      }
      walk(node.children ?? []);
    }
  };
  walk(nodes);
  return [...plans.values()];
}
