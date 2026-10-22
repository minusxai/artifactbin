/** Explicit offline route; never a fallback for blocked static conversion. */
import { MAX_PAGE_SOURCE } from "../../../af-contracts.ts";
import { Parser } from "acorn";
import {
  prepareAuthorDocument,
  compiledAuthorMountAttributes,
} from "./author-document.ts";
import { admitAuthorSource } from "./author/admission.ts";
import { validDatasetBinding } from "./dataset-reader.ts";
import { validLocalValue } from "./local-state.ts";
import { safeInlineModule } from "./module-safety.ts";
import jsx from "acorn-jsx";
import { parseFragment, serialize } from "parse5";
import { convertLegacyJsx } from "../index.ts";
import { externalCompile } from "./index.ts";
import {
  MAX_COMPILED_SOURCE_BYTES,
  MAX_COMPILED_OUTPUT_BYTES,
} from "./contracts.ts";
import type { CompiledMigrationInput } from "./contracts.ts";
import type {
  ArchivedLocalOptions,
  ArchivedLocalOutput,
  CompiledLocalResult,
} from "./local-contracts.ts";
export type * from "./local-contracts.ts";
const blocked = (code: string): CompiledLocalResult => ({
  classification: "manual-blocked",
  html: null,
  identities: {},
  capabilities: [],
  issues: [
    {
      code,
      message:
        "Local compiled capability requires an explicit migration adapter",
      path: "root",
    },
  ],
});
const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const activeUri = (v: string) =>
  /^(javascript|vbscript|blob|data):/.test(
    v.replace(/[\u0000-\u0020\u007f]/g, "").toLowerCase(),
  );
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const allowed = new Set(
  "Helmet Import Value Query Question Chart Number Cell Button Input Textarea Card CardHeader CardTitle CardDescription CardAction CardContent CardFooter Badge Alert AlertTitle AlertDescription Grid GridItem Markdown Icon Table TableHeader TableBody TableFooter TableRow TableHead TableCell TableCaption Separator Skeleton Progress".split(
    " ",
  ),
);
export async function compileArchivedLocal(
  input: CompiledMigrationInput,
  options: ArchivedLocalOptions,
): Promise<CompiledLocalResult> {
  try {
    const url = new URL(input.coreUrl, "https://example.invalid");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.pathname != "/af/v1/core.js" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return blocked("compiled-core");
  } catch {
    return blocked("compiled-core");
  }
  if (Buffer.byteLength(input.source) > MAX_COMPILED_SOURCE_BYTES)
    return blocked("compiled-limit");
  const strict = convertLegacyJsx(input);
  if (
    strict.issues.some(
      (i) =>
        !(
          i.code === "attribute" &&
          i.message === "Dynamic attribute requires an adapter: value"
        ) &&
        ![
          "component",
          "value",
          "action-adapter",
          "reference",
          "data-adapter",
        ].includes(i.code),
    )
  )
    return blocked("compiled-capability");
  const author = input.authorPlan;
  if (author) {
    try {
      admitAuthorSource(author.script);
      if (
        Buffer.byteLength(author.script) > 1024 * 1024 ||
        author.exports.length > 64 ||
        author.mounts.length > 256
      )
        return blocked("compiled-author-limit");
    } catch {
      return blocked("compiled-author-capability");
    }
  }
  const historical =
    input.datasetUnavailable?.reason === "historical-binding-unavailable";
  if (input.datasetUnavailable && !historical)
    return blocked("compiled-dataset-unavailable-mode");
  const bindings = input.datasetBindings ?? [];
  if (historical && bindings.length)
    return blocked("compiled-dataset-unavailable-mode");
  const backendLinks = new Map<string, string>();
  if (
    !Array.isArray(bindings) ||
    bindings.some((b) => !b) ||
    bindings.length > 16 ||
    new Set(bindings.map((b) => b.name)).size !== bindings.length ||
    bindings.some(
      (b) =>
        !validDatasetBinding(b) ||
        !/^ref:[A-Za-z0-9]{6,12}$/.test(b.legacyRef) ||
        ["compiledPage", "authorSignals"].includes(b.backendNamespace),
    )
  )
    return blocked("compiled-dataset-binding");
  for (const b of bindings) {
    if (
      backendLinks.has(b.backendNamespace) &&
      backendLinks.get(b.backendNamespace) !== b.backendHref
    )
      return blocked("compiled-dataset-binding");
    backendLinks.set(b.backendNamespace, b.backendHref);
  }
  let invalid = false;
  let chartCount = 0,
    vegaCount = 0;
  const imports = new Set<string>();
  const declarations = new Set<string>();
  const tableNames = new Set<string>();
  const scalarBindings = new Set<string>();
  const references = new Set<string>();
  const queries = new Set<string>();
  const safeExpression = (node: any): boolean => {
    if (node.type === "Literal")
      return (
        node.value === null ||
        ["string", "number", "boolean"].includes(typeof node.value)
      );
    if (
      node.type === "Identifier" &&
      /^\$[A-Za-z][A-Za-z0-9_]*$/.test(node.name)
    ) {
      references.add(node.name.slice(1));
      return true;
    }
    if (node.type === "TemplateLiteral") return node.expressions.length === 0;
    if (node.type === "UnaryExpression" && ["-", "+"].includes(node.operator))
      return (
        node.argument.type === "Literal" &&
        typeof node.argument.value === "number"
      );
    if (node.type === "ArrayExpression")
      return node.elements.every((v: any) => v && safeExpression(v));
    if (node.type === "ObjectExpression")
      return node.properties.every(
        (p: any) =>
          p.type === "Property" &&
          !p.computed &&
          !p.method &&
          p.kind === "init" &&
          !["__proto__", "constructor", "prototype"].includes(
            p.key.name ?? p.key.value,
          ) &&
          safeExpression(p.value),
      );
    return false;
  };
  try {
    const text = "<>" + input.source + "</>";
    const tree = Parser.extend(jsx()).parseExpressionAt(text, 0, {
      ecmaVersion: "latest",
    }) as any;
    if (tree.end !== text.length) return blocked("compiled-source");
    const walk = (node: any) => {
      if (
        node.type === "JSXExpressionContainer" &&
        !safeExpression(node.expression)
      )
        invalid = true;
      if (node.type === "JSXElement") {
        const name = node.openingElement.name.name;
        if (
          typeof name !== "string" ||
          ["script", "iframe", "object", "embed"].includes(
            name.toLowerCase(),
          ) ||
          (/^[A-Z]/.test(name) &&
            !allowed.has(name) &&
            !author?.exports.includes(name))
        )
          invalid = true;
        if (["Question", "Chart"].includes(name)) {
          chartCount++;
          const attrs = node.openingElement.attributes;
          const data = attrs.find((a: any) => a.name?.name === "data");
          const viz = attrs.find((a: any) => a.name?.name === "viz");
          if (
            !viz ||
            !data ||
            typeof data.value?.value !== "string" ||
            !/^\$[A-Za-z][A-Za-z0-9_]*$/.test(data.value.value)
          )
            invalid = true;
          const kind = viz?.value?.expression?.properties?.find(
            (p: any) => (p.key?.name ?? p.key?.value) === "kind",
          )?.value?.value;
          if (!["table", "single_value"].includes(kind)) vegaCount++;
        }
        if (name === "Import") {
          const attrs = Object.fromEntries(
            node.openingElement.attributes.map((a: any) => [
              a.name?.name,
              a.value?.value,
            ]),
          );
          const binding = bindings.find(
            (b) => b.name === attrs.name && b.legacyRef === attrs.src,
          );
          if (
            (!historical && !binding) ||
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(attrs.name) ||
            ["constructor", "prototype", "__proto__"].includes(attrs.name) ||
            !/^ref:[A-Za-z0-9]{6,12}$/.test(attrs.src) ||
            imports.has(attrs.name) ||
            node.openingElement.attributes.length !== 2 ||
            Object.keys(attrs).some((k) => !["name", "src"].includes(k)) ||
            node.children.some(
              (c: any) => c.type !== "JSXText" || c.value.trim(),
            )
          )
            invalid = true;
          imports.add(attrs.name);
        }
        for (const attr of node.openingElement.attributes) {
          if (
            attr.value?.expression?.type === "ArrayExpression" &&
            !(name === "Value" && attr.name?.name === "value")
          )
            invalid = true;
          const attrName = attr.name?.name?.toLowerCase();
          if (
            attrName === "data-migration-dataset-status" ||
            attrName?.startsWith("data-migration-author-") ||
            (author?.exports.includes(name) &&
              ["constructor", "prototype", "__proto__"].includes(attrName))
          )
            invalid = true;
          const attrValue = attr.value?.value ?? attr.value?.expression?.value;
          if (
            author?.exports.includes(name) &&
            typeof attrValue === "string" &&
            /^\$[A-Za-z][A-Za-z0-9_]*$/.test(attrValue)
          )
            references.add(attrValue.slice(1));
          if (
            /^on/.test(attrName) ||
            attrName === "srcdoc" ||
            (["href", "src", "action", "formaction", "xlink:href"].includes(
              attrName,
            ) &&
              typeof attrValue === "string" &&
              activeUri(attrValue))
          )
            invalid = true;
          if (
            attr.type === "JSXAttribute" &&
            ["value", "checked", "data"].includes(attr.name.name) &&
            typeof attr.value?.value === "string" &&
            attr.value.value.startsWith("$")
          ) {
            references.add(attr.value.value.slice(1));
            if (
              ["Input", "Textarea", "input", "textarea", "select"].includes(
                name,
              )
            )
              scalarBindings.add(attr.value.value.slice(1));
          }
          if (attr.type === "JSXAttribute" && attr.name.name === "set") {
            const object = attr.value?.expression;
            if (object?.type !== "ObjectExpression") invalid = true;
            else
              for (const prop of object.properties) {
                references.add(prop.key?.name ?? prop.key?.value);
                scalarBindings.add(prop.key?.name ?? prop.key?.value);
                if (
                  typeof prop.value?.value === "string" &&
                  prop.value.value.startsWith("$")
                )
                  references.add(prop.value.value.slice(1));
              }
          }
          if (
            attr.type !== "JSXAttribute" ||
            typeof attr.name.name !== "string" ||
            [
              "run",
              "args",
              "row",
              "rowScope",
              "options",
              "query",
              "table",
            ].includes(attr.name.name)
          )
            invalid = true;
        }
        if (name === "Query") {
          const attrs = Object.fromEntries(
            node.openingElement.attributes.map((a: any) => [
              a.name.name,
              a.value?.value,
            ]),
          );
          if (
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(attrs.name) ||
            Object.keys(attrs).some((k) => !["id", "name"].includes(k)) ||
            queries.has(attrs.name) ||
            ["constructor", "prototype", "__proto__"].includes(attrs.name)
          )
            invalid = true;
          queries.add(attrs.name);
        }
        if (name === "Value") {
          const attrs = Object.fromEntries(
            node.openingElement.attributes.map((a: any) => [
              a.name.name,
              a.value?.value,
            ]),
          );
          if (
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(attrs.name) ||
            ["constructor", "prototype", "__proto__"].includes(attrs.name) ||
            declarations.has(attrs.name) ||
            !["string", "number", "boolean", "table"].includes(attrs.type)
          )
            invalid = true;
          declarations.add(attrs.name);
          if (attrs.type === "table") tableNames.add(attrs.name);
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === "start" || key === "end") continue;
        if (Array.isArray(value))
          value.forEach((v) => {
            if (v && typeof v === "object") walk(v);
          });
        else if (value && typeof value === "object") walk(value);
      }
    };
    walk(tree);
    if (
      [...references].some(
        (name) => !declarations.has(name) && !queries.has(name),
      )
    )
      invalid = true;
  } catch {
    return blocked("compiled-source");
  }
  if (
    [...queries].some((q) => declarations.has(q)) ||
    [...scalarBindings].some((n) => tableNames.has(n))
  )
    invalid = true;
  if (
    (!historical && imports.size !== bindings.length) ||
    (historical && imports.size === 0) ||
    [...imports].some((n) => declarations.has(n) || queries.has(n))
  )
    invalid = true;
  if (invalid || (declarations.size === 0 && queries.size === 0 && !author))
    return blocked("compiled-capability");
  let output: ArchivedLocalOutput;
  try {
    output = await (options.compiler?.compile(input) ??
      (externalCompile(
        input,
        options,
        "./local-runner.mts",
      ) as Promise<ArchivedLocalOutput>));
  } catch {
    return blocked("compiled-local-failed");
  }
  if (
    !safeInlineModule(output?.javascript) ||
    !output ||
    typeof output.html !== "string" ||
    typeof output.css !== "string" ||
    typeof output.title !== "string" ||
    typeof output.build !== "string" ||
    typeof output.javascript !== "string" ||
    !output.rootAttributes ||
    !output.javascript ||
    !Array.isArray(output.declarations) ||
    !Array.isArray(output.modules) ||
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
  const state: Record<string, unknown> = Object.create(null);
  for (const d of output.declarations) {
    if (
      !declarations.has(d.name) ||
      Object.hasOwn(state, d.name) ||
      !["string", "number", "boolean", "table"].includes(d.type) ||
      !validLocalValue(d, d.default)
    )
      return blocked("compiled-local-output");
    state[d.name] = d.default;
  }
  if (Object.keys(state).length !== declarations.size)
    return blocked("compiled-local-output");
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
        if (author && compiledAuthorMountAttributes[a.name])
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
  const attrs = Object.entries(output.rootAttributes)
    .filter(([key]) => ["class", "data-theme"].includes(key))
    .map(([key, value]) => ` ${key}="${esc(value)}"`)
    .join("");
  const links = [...backendLinks]
    .map(
      ([name, href]) =>
        `<link rel="af-backend" href="${esc(href)}" data-af-name="${esc(name)}">`,
    )
    .join("");
  const status = imports.size
    ? historical
      ? '<p role="status" data-migration-dataset-status>Historical data is unavailable. This saved page does not load datasets or evaluate queries.</p>'
      : '<p role="status" data-migration-dataset-status>Loading protected data…</p>'
    : "";
  const authorStatus = author
    ? '<p role="status" data-migration-author-status>Starting page components…</p>'
    : "";
  const html = `<!doctype html><html${attrs}><head><meta charset="utf-8"><script data-af="core" src="${esc(input.coreUrl)}"></script><script type="application/json" data-af="state">${json({ compiledPage: state, ...(author ? { authorSignals: {} } : {}) })}</script>${links}<title>${esc(output.title)}</title><style>${output.css}</style></head><body>${status}${authorStatus}${serialize(fragment)}<script type="module">${output.javascript.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
  if (Buffer.byteLength(html) > MAX_PAGE_SOURCE)
    return blocked("compiled-page-limit");
  return {
    classification: historical ? "renderable" : "functional",
    html,
    identities,
    issues: [],
    capabilities: [
      "local-scalars",
      "archived-kit",
      "inlined-fonts",
      ...(queries.size && !historical ? ["local-sql-queries"] : []),
      ...(tableNames.size ? ["local-inline-tables"] : []),
      ...(imports.size
        ? [
            historical
              ? "historical-data-unavailable"
              : "protected-dataset-reads",
          ]
        : []),
      ...(author ? ["authored-components"] : []),
      ...(chartCount ? ["compiled-charts"] : []),
    ],
    provenance: {
      compiler: author ? "archived-author" : "archived-local",
      build: output.build,
      mode: historical
        ? "historical-data-unavailable"
        : author
          ? "authored-components"
          : "local-scalars",
      modules: output.modules,
    },
  };
}

/** Explicit whole-document author migration. No fallback from another strategy. */
export async function compileArchivedAuthor(
  input: CompiledMigrationInput,
  options: ArchivedLocalOptions,
): Promise<CompiledLocalResult> {
  try {
    const plan = prepareAuthorDocument(input.source);
    return await compileArchivedLocal(
      { ...input, source: plan.source, authorPlan: plan.author },
      options,
    );
  } catch {
    return blocked("compiled-author-capability");
  }
}
