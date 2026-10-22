/** Explicit offline route; never a fallback for blocked static conversion. */
import { Parser } from "acorn";
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
  "Helmet Value Button Input Textarea Card CardHeader CardTitle CardDescription CardAction CardContent CardFooter Badge Alert AlertTitle AlertDescription Grid GridItem Markdown Icon Table TableHeader TableBody TableFooter TableRow TableHead TableCell TableCaption Separator Skeleton Progress".split(
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
        !["component", "value", "action-adapter", "reference"].includes(i.code),
    )
  )
    return blocked("compiled-capability");
  let invalid = false;
  const declarations = new Set<string>();
  const references = new Set<string>();
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
          (/^[A-Z]/.test(name) && !allowed.has(name))
        )
          invalid = true;
        for (const attr of node.openingElement.attributes) {
          const attrName = attr.name?.name?.toLowerCase();
          const attrValue = attr.value?.value ?? attr.value?.expression?.value;
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
            ["value", "checked"].includes(attr.name.name) &&
            typeof attr.value?.value === "string" &&
            attr.value.value.startsWith("$")
          )
            references.add(attr.value.value.slice(1));
          if (attr.type === "JSXAttribute" && attr.name.name === "set") {
            const object = attr.value?.expression;
            if (object?.type !== "ObjectExpression") invalid = true;
            else
              for (const prop of object.properties) {
                references.add(prop.key?.name ?? prop.key?.value);
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
            !["string", "number", "boolean"].includes(attrs.type)
          )
            invalid = true;
          declarations.add(attrs.name);
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
    if ([...references].some((name) => !declarations.has(name))) invalid = true;
  } catch {
    return blocked("compiled-source");
  }
  if (invalid || declarations.size === 0) return blocked("compiled-capability");
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
    output.modules.some((m) =>
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
  const state: Record<string, unknown> = Object.create(null);
  for (const d of output.declarations) {
    if (
      !declarations.has(d.name) ||
      Object.hasOwn(state, d.name) ||
      !["string", "number", "boolean"].includes(d.type) ||
      (d.default !== null && typeof d.default !== d.type)
    )
      return blocked("compiled-local-output");
    state[d.name] = d.default;
  }
  if (Object.keys(state).length !== declarations.size)
    return blocked("compiled-local-output");
  const identities: Record<string, string> = Object.create(null);
  let unsafe = false;
  const fragment = parseFragment(output.html);
  const visit = (node: any) => {
    if (node.tagName) {
      if (["script", "iframe", "object", "embed"].includes(node.tagName))
        unsafe = true;
      for (const a of [...node.attrs]) {
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
      node.attrs = node.attrs.filter(
        (a: any) => !["data-mx-ast", "data-mx-source-node-id"].includes(a.name),
      );
    }
    for (const c of node.childNodes ?? []) visit(c);
  };
  visit(fragment);
  if (unsafe) return blocked("compiled-local-output");
  const attrs = Object.entries(output.rootAttributes)
    .filter(([key]) => ["class", "data-theme"].includes(key))
    .map(([key, value]) => ` ${key}="${esc(value)}"`)
    .join("");
  return {
    classification: "functional",
    html: `<!doctype html><html${attrs}><head><meta charset="utf-8"><script data-af="core" src="${esc(input.coreUrl)}"></script><script type="application/json" data-af="state">${json({ compiledPage: state })}</script><title>${esc(output.title)}</title><style>${output.css}</style></head><body>${serialize(fragment)}<script type="module">${output.javascript.replace(/<\/script/gi, "<\\/script")}</script></body></html>`,
    identities,
    issues: [],
    capabilities: ["local-scalars", "archived-kit", "inlined-fonts"],
    provenance: {
      compiler: "archived-local",
      build: output.build,
      mode: "local-scalars",
      modules: output.modules,
    },
  };
}
