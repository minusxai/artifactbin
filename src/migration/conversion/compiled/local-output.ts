/** Compiler-output admission owns shape, source reconciliation, bundle policy,
 * HTML identity repair and author mount verification; never invokes a compiler. */
import { parseFragment, serialize } from "parse5";
import { safeInlineModule } from "./module-safety.ts";
import { compiledAuthorMountAttributes } from "./author-document.ts";
import { reconcileLocalDeclarations } from "./source-manifest.ts";
import { MAX_COMPILED_OUTPUT_BYTES } from "./contracts.ts";
import type { ArchivedLocalOutput } from "./local-contracts.ts";
import type {
  AdmitLocalOutput,
  LocalOutputAdmission,
} from "./local-output-contracts.ts";
const blocked = (code: string): LocalOutputAdmission => ({ ok: false, code });
const activeUri = (v: string) =>
  /^(javascript|vbscript|blob|data):/.test(
    v.replace(/[\u0000-\u0020\u007f]/g, "").toLowerCase(),
  );
export const admitLocalOutput: AdmitLocalOutput = (plan, raw) => {
  const output = raw as ArchivedLocalOutput;
  const {
    author,
    vegaCount,
    mutationNames: mutations,
    queryNames: queries,
    datasetNames: imports,
  } = plan;
  if (
    !safeInlineModule(output?.javascript) ||
    !output ||
    typeof output.html !== "string" ||
    typeof output.css !== "string" ||
    typeof output.title !== "string" ||
    typeof output.build !== "string" ||
    typeof output.javascript !== "string" ||
    !output.rootAttributes ||
    Array.isArray(output.rootAttributes) ||
    typeof output.rootAttributes !== "object" ||
    Object.values(output.rootAttributes).some((v) => typeof v !== "string") ||
    !output.javascript ||
    !Array.isArray(output.declarations) ||
    [
      output.queryNames,
      output.datasetNames,
      output.mutationNames,
      output.authorExports,
    ].some(
      (names) =>
        names !== undefined &&
        (!Array.isArray(names) ||
          names.some((name) => typeof name !== "string")),
    ) ||
    !Array.isArray(output.modules) ||
    output.modules.some((m) => typeof m !== "string") ||
    output.modules.some(
      (m) =>
        m !== "dataflow.ts" &&
        ![
          "vega-dataflow/build/vega-dataflow.js",
          "vega-expression/src/parser.js",
          "vega-functions/src/parser.js",
          "vega-runtime/src/dataflow.js",
        ].includes(m) &&
        /boot|editor|transport|page-store|dataflow|jsx\/|parser|page-runtime/i.test(
          m,
        ),
    ) ||
    /\/api\/|\/islands\/|@mx\/boot|EventSource|WebSocket|parseJsx|parseExpressionAt|new Function|\beval\s*\(/.test(
      output.javascript,
    ) ||
    /<\/style/i.test(output.css) ||
    Buffer.byteLength(output.html + output.css + output.javascript) >
      MAX_COMPILED_OUTPUT_BYTES
  )
    return blocked("compiled-local-output");
  if (
    vegaCount &&
    (!Number.isSafeInteger(output.chartPlans) ||
      !output.chartPlans ||
      output.chartPlans > vegaCount)
  )
    return blocked("compiled-chart-output");
  if (
    (output.mutationNames ?? []).length !== mutations.size ||
    [...mutations].some((n) => !output.mutationNames?.includes(n))
  )
    return blocked("compiled-mutation-output");
  if (!reconcileLocalDeclarations(plan.manifest, output.declarations))
    return blocked("compiled-local-output");
  const state: Record<string, unknown> = Object.create(null);
  for (const declaration of plan.manifest.declarations)
    state[declaration.name] = declaration.default;
  if (
    (output.queryNames ?? []).length !== queries.size ||
    [...queries].some((q) => !output.queryNames?.includes(q))
  )
    return blocked("compiled-local-output");
  if (
    (output.datasetNames ?? []).length !== imports.size ||
    [...imports].some((n) => !output.datasetNames?.includes(n))
  )
    return blocked("compiled-local-output");
  if (
    author &&
    author.exports.some((name) => !output.authorExports?.includes(name))
  )
    return blocked("compiled-author-output");
  const authorMounts = new Set<string>();
  const identities: Record<string, string> = Object.create(null);
  let unsafe = false;
  const fragment = parseFragment(output.html);
  const visit = (node: any) => {
    if (node.tagName) {
      if (["script", "iframe", "object", "embed"].includes(node.tagName))
        unsafe = true;
      for (const a of [...node.attrs]) {
        if (author && Object.hasOwn(compiledAuthorMountAttributes, a.name))
          a.name = compiledAuthorMountAttributes[a.name];
        if (
          (["href", "src", "action", "formaction", "xlink:href"].includes(
            a.name,
          ) &&
            activeUri(a.value)) ||
          /^on/i.test(a.name) ||
          a.name === "srcdoc" ||
          (["src", "srcset", "poster"].includes(a.name) &&
            !a.value.startsWith("data:"))
        )
          unsafe = true;
        if (a.name === "id") {
          if (Object.hasOwn(identities, a.value)) unsafe = true;
          identities[a.value] = a.value;
          node.attrs.push({ name: "data-af-id", value: a.value });
        }
      }
      const authorComponent = node.attrs.find(
        (a: any) => a.name === "data-migration-author-component",
      )?.value;
      if (authorComponent) {
        const id = node.attrs.find((a: any) => a.name === "id")?.value;
        if (
          !author?.mounts.some(
            (m) => m.identity === id && m.component === authorComponent,
          ) ||
          authorMounts.has(id)
        )
          unsafe = true;
        authorMounts.add(id);
      }
      node.attrs = node.attrs.filter(
        (a: any) => !["data-mx-ast", "data-mx-source-node-id"].includes(a.name),
      );
    }
    for (const c of node.childNodes ?? []) visit(c);
  };
  visit(fragment);
  if (unsafe || (author && authorMounts.size !== author.mounts.length))
    return blocked("compiled-local-output");
  return {
    ok: true,
    value: { output, body: serialize(fragment), state, identities },
  };
};
