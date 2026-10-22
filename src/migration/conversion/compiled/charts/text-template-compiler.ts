import type { CompiledChartPlan } from "./contracts.ts";
import { parse } from "acorn";
import { chartEnvelopeKey } from "./plan.ts";
type TextBinding = NonNullable<CompiledChartPlan["textBindings"]>[number];
const PREFIX = "migration_chart_text_";

/** Only fixed, whole query-cell text leaves; no expression or structural templates. */
export function prepareChartTextTemplate(input: Record<string, unknown>): {
  viz: Record<string, unknown>;
  bindings: TextBinding[];
} {
  const source = chartEnvelopeKey(input);
  if (source.includes(PREFIX)) throw Error("Reserved chart signal name");
  const viz = JSON.parse(source);
  const bindings: TextBinding[] = [];
  const walk = (value: any, path: string[]) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      const next = [...path, key];
      if (typeof item === "string" && /\{\$/.test(item)) {
        if (
          viz.kind !== "vega-lite" ||
          !/^spec\.encoding\.[xy]\.(?:title|axis\.format)$/.test(
            next.join("."),
          ) ||
          !/^\{\$[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*\}$/.test(item)
        )
          throw Error("Chart template location requires an adapter");
        if (bindings.length >= 4)
          throw Error("Chart text binding limit exceeded");
        const signal = PREFIX + bindings.length;
        const marker = signal + "_literal";
        bindings.push({ path: ["source", ...next], signal, marker });
        value[key] = marker;
      } else walk(item, next);
    }
  };
  walk(viz, []);
  return { viz, bindings };
}

/** Applied to the trusted compiler result before offline Vega parsing. */
export function bindChartTextPlan(
  spec: Record<string, any>,
  bindings: TextBinding[],
): void {
  if (!bindings.length) return;
  for (const binding of bindings) {
    const property = binding.path.at(-1)!;
    const axes = Array.isArray(spec.axes) ? spec.axes : [];
    const targets = axes.filter(
      (axis: any) => axis[property] === binding.marker,
    );
    if (targets.length !== 1)
      throw Error("Compiled chart text binding is ambiguous or unavailable");
    targets[0][property] = { signal: binding.signal };
  }
  const signals = Array.isArray(spec.signals) ? spec.signals : [];
  if (
    signals.some((signal: any) =>
      bindings.some((b) => b.signal === signal.name),
    )
  )
    throw Error("Compiled chart signal name collision");
  rewriteGeneratedTextExpressions(spec, bindings);
  spec.signals = [
    ...signals,
    ...bindings.map((b) => ({ name: b.signal, value: "" })),
  ];
}

/** The offline compiler may repeat axis text in generated ARIA expressions. */
function rewriteGeneratedTextExpressions(
  spec: unknown,
  bindings: TextBinding[],
): void {
  const visit = (value: any): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (
        typeof item === "string" &&
        bindings.some((b) => item.includes(b.marker))
      ) {
        if (key !== "signal")
          throw Error("Compiled chart text escaped its fixed axis slot");
        const expressionSource = "(" + item + ")";
        const program = parse(expressionSource, { ecmaVersion: 2022 }) as any;
        if (
          program.body.length !== 1 ||
          program.body[0].type !== "ExpressionStatement"
        )
          throw Error("Unsupported compiled chart expression");
        const ast = program.body[0].expression;
        const render = (node: any): string => {
          if (
            node.type === "Literal" &&
            typeof node.value === "string" &&
            bindings.some((b) => node.value.includes(b.marker))
          ) {
            let parts: Array<{ text: string; signal?: string }> = [
              { text: node.value },
            ];
            for (const b of bindings)
              parts = parts.flatMap((p) =>
                p.signal
                  ? [p]
                  : p.text
                      .split(b.marker)
                      .flatMap((text, i) =>
                        i
                          ? [{ text: "", signal: b.signal }, { text }]
                          : [{ text }],
                      ),
              );
            return (
              "(" +
              parts.map((p) => p.signal ?? JSON.stringify(p.text)).join(" + ") +
              ")"
            );
          }
          if (
            node.type === "ObjectExpression" &&
            node.properties.some(
              (p: any) =>
                p.key?.type === "Literal" &&
                typeof p.key.value === "string" &&
                bindings.some((b) => p.key.value.includes(b.marker)),
            )
          ) {
            if (
              node.properties.length > 64 ||
              node.properties.some(
                (p: any) =>
                  p.type !== "Property" ||
                  p.computed ||
                  p.method ||
                  p.kind !== "init",
              )
            )
              throw Error("Unsupported generated chart tooltip object");
            const keys = node.properties.map((p: any) =>
              p.key.type === "Identifier"
                ? JSON.stringify(p.key.name)
                : render(p.key),
            );
            const values = node.properties.map((p: any) => render(p.value));
            return (
              "migration_chart_text_object([" +
              keys.join(",") +
              "],[" +
              values.join(",") +
              "])"
            );
          }
          const children: any[] = [];
          for (const child of Object.values(node)) {
            if (Array.isArray(child))
              children.push(
                ...child.filter((n: any) => n && typeof n.type === "string"),
              );
            else if (
              child &&
              typeof child === "object" &&
              typeof (child as any).type === "string"
            )
              children.push(child);
          }
          let result = expressionSource.slice(node.start, node.end);
          for (const child of children.sort((a, b) => b.start - a.start))
            result =
              result.slice(0, child.start - node.start) +
              render(child) +
              result.slice(child.end - node.start);
          return result;
        };
        const result = render(ast);
        if (bindings.some((b) => result.includes(b.marker)))
          throw Error("Unresolved compiled chart text expression");
        value[key] = result;
      } else visit(item);
    }
  };
  visit(spec);
}
