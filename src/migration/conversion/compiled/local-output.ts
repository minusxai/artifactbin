import {reconcileMermaidHtml} from "./mermaid-output.ts";
import {reconcileSlideDeckHtml} from "./slide-deck-output.ts";
import {reconcileAuthorProps} from "./author/props.ts";
import {initialDynamicIdentities,allowedInitialDynamicIdentities} from "./dynamic-identities.ts";
/** Compiler-output admission owns shape, source reconciliation, bundle policy,
 * HTML identity repair and author mount verification; never invokes a compiler. */
import { parseFragment, serialize } from "parse5";
import { safeInlineModule, validCompiledModule } from "./module-safety.ts";
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
  const prototype=plan.sourceAdmission==="offline-prototype";
  const {
    author,
    vegaCount,
    mutationNames: mutations,
    queryNames: queries,
    datasetNames: imports,
  } = plan;
  if (
    !(prototype ? validCompiledModule(output?.javascript) : safeInlineModule(output?.javascript)) ||
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
    (!prototype && output.modules.some(
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
    )) ||
    (!prototype && /\/api\/|\/islands\/|@mx\/boot|EventSource|WebSocket|parseJsx|parseExpressionAt|new Function|\beval\s*\(/.test(
      output.javascript,
    )) ||
    (!prototype && /<\/style/i.test(output.css)) ||
    Buffer.byteLength(output.html + output.css + output.javascript) >
      MAX_COMPILED_OUTPUT_BYTES
  )
    return blocked("compiled-local-output");
  if (
    vegaCount &&
    !(prototype && output.chartRuntime === "archived-controller") &&
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
      if (!prototype && ["script", "iframe", "object", "embed"].includes(node.tagName))
        unsafe = true;
      for (const a of [...node.attrs]) {
        if (author && Object.hasOwn(compiledAuthorMountAttributes, a.name))
          a.name = compiledAuthorMountAttributes[a.name];
        if (!prototype && (
          (["href", "src", "action", "formaction", "xlink:href"].includes(
            a.name,
          ) &&
            activeUri(a.value)) ||
          /^on/i.test(a.name) ||
          a.name === "srcdoc" ||
          (!prototype && ["src", "srcset", "poster"].includes(a.name) &&
            !a.value.startsWith("data:"))
        ))
          unsafe = true;
        if (a.name === "id") {
          if (Object.hasOwn(identities, a.value)) unsafe = true;
          identities[a.value] = a.value;

        }
      }
      const authorComponent = node.attrs.find(
        (a: any) => a.name === "data-migration-author-component",
      )?.value;
      if (authorComponent && !prototype) {
        const id = node.attrs.find((a: any) => a.name === "id")?.value;
        if (
          !author?.mounts.some(
            (m) => m.identity === id && m.component === authorComponent,
          ) ||
          authorMounts.has(id)
        )
          unsafe = true;
        const expected = plan.authorProps.find(m => m.identity === id && m.component === authorComponent);
        try {
          const propAttrs = node.attrs.filter((a:any) => a.name === "data-migration-author-props");
          const bindAttrs = node.attrs.filter((a:any) => a.name === "data-migration-author-bind");
          const className = node.attrs.find((a:any) => a.name === "class")?.value;
          if (!expected || propAttrs.length !== 1 || bindAttrs.length !== 1 || propAttrs[0].value.length > 256*1024 || bindAttrs[0].value.length > 256*1024 || className !== expected.className || !reconcileAuthorProps(expected, JSON.parse(propAttrs[0].value), JSON.parse(bindAttrs[0].value))) unsafe = true;
        } catch { unsafe = true; }
        authorMounts.add(id);
      }
      if(plan.input.slideDeck){
        const path=node.attrs.find((a:any)=>a.name==='data-mx-ast');
        node.attrs=node.attrs.filter((a:any)=>a.name!=='data-af-deck-path');
        if(path)node.attrs.push({name:'data-af-deck-path',value:path.value});
      }
      node.attrs = node.attrs.filter(
        (a: any) => !["data-af-id", "data-mx-ast", "data-mx-source-node-id"].includes(a.name),
      );
      const id = node.attrs.find((a: any) => a.name === "id");
      if (id) node.attrs.push({ name: "data-af-id", value: id.value });
    }
    for (const c of node.childNodes ?? []) visit(c);
    if(plan.input.slideDeck && node.content)visit(node.content);
  };
  visit(fragment);
  if(!prototype&&!reconcileMermaidHtml(fragment,plan.input.mermaids??[],Boolean(plan.input.slideDeck)))return blocked("compiled-mermaid-output");
  if(!prototype&&!reconcileSlideDeckHtml(fragment,plan.input.slideDeck))return blocked("compiled-slide-output");
  const initialIdentities = new Set(initialDynamicIdentities(plan.dynamicIdentities, Object.fromEntries(plan.manifest.declarations.map(d => [d.name,d.default]))));
  const allowedIdentities = new Set(allowedInitialDynamicIdentities(plan.dynamicIdentities, Object.fromEntries(plan.manifest.declarations.map(d => [d.name,d.default]))));
  if (unsafe || (!prototype && ([...initialIdentities].some((id) => !Object.hasOwn(identities, id)) || [...plan.renderedIdentities].some(id => Object.hasOwn(identities,id) && !allowedIdentities.has(id)))) || (!prototype && author && authorMounts.size !== author.mounts.length))
    return blocked("compiled-local-output");
  return {
    ok: true,
    value: { output, body: serialize(fragment), state, identities },
  };
};
