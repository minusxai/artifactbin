import type { CompiledChartPlan } from "./contracts.ts";
import { chartEnvelopeKey } from "./plan.ts";
/** Match every fixed envelope leaf, then pass only primitive values to declared signals. */
export function matchChartTextPlan(
  plan: CompiledChartPlan,
  envelope: unknown,
): Array<{ signal: string; value: string | number | boolean | null }> | null {
  if (!plan.textBindings?.length) return null;
  const masked = JSON.parse(chartEnvelopeKey(envelope));
  const values: Array<{
    signal: string;
    value: string | number | boolean | null;
  }> = [];
  for (const binding of plan.textBindings) {
    let parent = masked;
    for (const key of binding.path.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key))
        return null;
      parent = parent[key];
    }
    const key = binding.path.at(-1)!;
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key))
      return null;
    const value = parent[key];
    if (
      !(
        value === null ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)) ||
        (typeof value === "string" &&
          value.length <= (key === "format" ? 256 : 4096))
      )
    )
      return null;
    values.push({ signal: binding.signal, value });
    parent[key] = binding.marker;
  }
  return chartEnvelopeKey(masked) === plan.key ? values : null;
}
