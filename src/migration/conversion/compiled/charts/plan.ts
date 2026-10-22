import type {
  ChartCompilationInput,
  ChartCompilerPorts,
  CompiledChartPlan,
} from "./contracts.ts";
const MAX_PLAN_BYTES = 512 * 1024;
/** Bounded canonical JSON also makes equivalent envelope property order irrelevant. */
export function chartEnvelopeKey(value: unknown): string {
  let nodes = 0;
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > 50000 || depth > 64)
      throw Error("Chart structure exceeds limit");
    if (item === null || typeof item === "boolean" || typeof item === "string")
      return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map((v) => visit(v, depth + 1));
    if (
      item &&
      typeof item === "object" &&
      Object.getPrototypeOf(item) === Object.prototype
    )
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [
            key,
            visit((item as Record<string, unknown>)[key], depth + 1),
          ]),
      );
    throw Error("Chart must be JSON");
  };
  const key = JSON.stringify(visit(value, 0));
  if (new TextEncoder().encode(key).length > MAX_PLAN_BYTES)
    throw Error("Chart structure exceeds limit");
  return key;
}
function admit(value: unknown): void {
  if (typeof value === "string") {
    if (/\{\$|(?:^|[^a-z])(?:window|document|timer):/.test(value))
      throw Error("Dynamic chart spec or ambient events unsupported");
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(admit);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (["url", "href", "assets"].includes(key) && item != null)
      throw Error("Chart resource requires an adapter");
    if (key === "type" && item === "image")
      throw Error("Image marks unsupported");
    if (key === "source" && ["window", "timer"].includes(String(item)))
      throw Error("Ambient chart events unsupported");
    admit(item);
  }
}
/** All grammar parsing happens offline. Runtime plans cannot load resources or bake query rows into HTML. */
export function compileChartPlan(
  input: ChartCompilationInput,
  ports: ChartCompilerPorts,
): CompiledChartPlan {
  if (!["vega", "vega-lite", "recipe"].includes(String(input.viz.kind)))
    throw Error("Unsupported chart kind");
  if (
    input.viz.kind === "recipe" &&
    (!String(input.viz.recipe).startsWith("minusx/") ||
      String(input.viz.recipe).startsWith("ref:"))
  )
    throw Error("Unresolved chart recipe");
  chartEnvelopeKey(input.viz);
  admit(input.viz);
  const { width, height } = input;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 80 ||
    height < 60 ||
    width > 4096 ||
    height > 4096
  )
    throw Error("Chart dimensions exceed limit");
  const envelope = ports.envelope(
    JSON.parse(JSON.stringify(input.viz)),
    input.columns,
  );
  if (!envelope || typeof envelope !== "object" || "error" in envelope)
    throw Error("Chart envelope refused");
  const key = chartEnvelopeKey(envelope);
  const resolved = ports.resolve(envelope, ports.infer(input.rows));
  if (!resolved.ok || Object.keys(resolved.assets ?? {}).length)
    throw Error("Chart resolution requires an adapter");
  const plan = ports.plan(
    resolved,
    [],
    { width, height },
    input.colorMode,
    null,
  );
  if (plan.facetLayout) throw Error("Facet layout requires an adapter");
  // Vega-Lite container sizing emits window:resize; ResizeObserver owns sizing here.
  const spec = plan.vegaSpec as Record<string, unknown>;
  if (Array.isArray(spec.signals))
    for (const signal of spec.signals) {
      if (
        signal &&
        ["width", "height"].includes(signal.name) &&
        typeof signal.init === "string" &&
        /^isFinite\(containerSize\(\)\[[01]\]\)/.test(signal.init) &&
        Array.isArray(signal.on) &&
        signal.on.every(
          (event: any) =>
            event.events === "window:resize" && event.update === signal.init,
        )
      ) {
        signal.value = signal.name === "width" ? width : height;
        delete signal.init;
        delete signal.on;
      }
    }
  admit(plan.vegaSpec);
  const runtime = JSON.parse(
    chartEnvelopeKey(
      JSON.parse(
        JSON.stringify(
          ports.parse(plan.vegaSpec, plan.parserConfig, { ast: true }),
        ),
      ),
    ),
  ) as Record<string, unknown>;
  return { key, runtime, width, height };
}

/** These two Question views are rendered reactively by the kit and need no Vega engine. */
export function isKitQuestionView(viz: unknown): boolean {
  return (
    !!viz &&
    typeof viz === "object" &&
    ["table", "single_value"].includes(
      String((viz as Record<string, unknown>).kind),
    )
  );
}
