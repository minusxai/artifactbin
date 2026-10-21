/** Offline-only source conversion. Never import this module from the product runtime. */
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import type { ConversionInput, ConversionResult } from "./contracts.ts";
export type {
  ConversionInput,
  ConversionResult,
  ConversionIssue,
} from "./contracts.ts";
// Acorn extensions expose heterogeneous syntax nodes; all accepted forms are checked below.
type Node = { type: string; [key: string]: any };
const esc = (v: unknown) =>
  String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const voids = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
export function convertLegacyJsx(input: ConversionInput): ConversionResult {
  const result: ConversionResult = {
    classification: "renderable",
    html: null,
    issues: [],
    identities: {},
    capabilities: [],
  };
  const issue = (code: string, message: string, path: string) => {
    result.issues.push({ code, message, path });
  };
  let root: Node;
  try {
    root = Parser.extend(jsx()).parseExpressionAt(
      "<>" + input.source + "</>",
      0,
      { ecmaVersion: "latest" },
    ) as Node;
  } catch {
    issue("syntax", "Cannot parse legacy JSX source", "root");
    return { ...result, classification: "manual-blocked" };
  }
  const state: Record<string, unknown> = {},
    styles = [...(input.styles ?? [])],
    head: string[] = [],
    bindings: Array<{
      id: string;
      field: string;
      kind: "text" | "set";
      value?: unknown;
    }> = [];
  let sequence = 0;
  function literal(node: Node): unknown {
    if (node.type === "Literal") return node.value;
    if (node.type === "TemplateLiteral" && !node.expressions.length)
      return node.quasis[0].value.cooked;
    if (
      node.type === "UnaryExpression" &&
      node.operator === "-" &&
      node.argument.type === "Literal" &&
      typeof node.argument.value === "number"
    )
      return -node.argument.value;
    throw new Error("Nonstatic expression");
  }
  function attrs(node: Node, path: string): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const a of node.openingElement.attributes) {
      if (a.type !== "JSXAttribute") {
        issue("spread", "Spread attributes require an explicit adapter", path);
        continue;
      }
      const name = a.name.name;
      if (/^on[A-Z]/.test(name) || /^on[a-z]/.test(name)) {
        issue("event", "Authored event handlers require rewriting", path);
        continue;
      }
      try {
        values[name] = !a.value
          ? true
          : a.value.type === "Literal"
            ? a.value.value
            : literal(a.value.expression);
      } catch {
        issue(
          "attribute",
          "Dynamic attribute requires an adapter: " + name,
          path,
        );
      }
    }
    return values;
  }
  function scan(node: Node, path: string) {
    if (
      node.type === "JSXElement" &&
      node.openingElement.name.name === "Value"
    ) {
      const a = attrs(node, path);
      if (
        typeof a.name !== "string" ||
        !/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(a.name) ||
        !["number", "string", "boolean"].includes(String(a.type))
      ) {
        issue("value", "Only typed scalar local values have an adapter", path);
        return;
      }
      const d =
        a.default ??
        (a.type === "number" ? 0 : a.type === "boolean" ? false : "");
      if (typeof d !== a.type) {
        issue("value", "Value default does not match its type", path);
        return;
      }
      state[a.name] = d;
      result.capabilities.push("local-state");
    }
    for (const [i, c] of (node.children ?? []).entries())
      scan(c, path + "." + i);
  }
  scan(root, "root");
  function render(node: Node, path: string, inHead = false): string {
    if (node.type === "JSXFragment")
      return node.children
        .map((c: Node, i: number) => render(c, path + "." + i, inHead))
        .join("");
    if (node.type === "JSXText") return esc(node.value);
    if (node.type === "JSXExpressionContainer") {
      if (node.expression.type === "JSXEmptyExpression") return "";
      if (
        node.expression.type === "Identifier" &&
        /^\$[A-Za-z_]\w*$/.test(node.expression.name)
      ) {
        const field = node.expression.name.slice(1),
          id = "migration-binding-" + ++sequence;
        if (!(field in state)) {
          issue("reference", "Unknown local state reference", path);
          return "";
        }
        bindings.push({ id, field, kind: "text" });
        return `<span data-af-id="${id}">${esc(state[field])}</span>`;
      }
      try {
        return esc(literal(node.expression));
      } catch {
        issue(
          "expression",
          "Executable or reactive expression needs an adapter",
          path,
        );
        return "";
      }
    }
    if (node.type !== "JSXElement") {
      issue("syntax", "Unsupported source node", path);
      return "";
    }
    const name = node.openingElement.name.name;
    if (typeof name !== "string") {
      issue("component", "Namespaced component requires rewriting", path);
      return "";
    }
    const a = attrs(node, path);
    if (name === "Helmet") {
      node.children.forEach((c: Node, i: number) => {
        const h = render(c, path + "." + i, true);
        if (h.trim()) head.push(h);
      });
      return "";
    }
    if (name === "Value") return "";
    if (["Query", "Import", "Mutation", "Column"].includes(name)) {
      issue(
        "data-adapter",
        "Queries, shared data and actions require backend adapters",
        path,
      );
      return "";
    }
    if (name === "script") {
      issue(
        "script",
        "Custom scripts require state and package rewriting",
        path,
      );
      return "";
    }
    if (name === "style") {
      const css = node.children
        .map((c: Node) =>
          c.type === "JSXExpressionContainer"
            ? (() => {
                try {
                  return String(literal(c.expression));
                } catch {
                  issue("style", "Dynamic CSS requires rewriting", path);
                  return "";
                }
              })()
            : (c.value ?? ""),
        )
        .join("");
      if (/<\/style/i.test(css)) {
        issue("style", "Unsafe style closing sequence", path);
        return "";
      }
      styles.push(css);
      return "";
    }
    let tag = name;
    if (name === "Button") {
      tag = "button";
      if (
        a.run ||
        typeof a.set !== "string" ||
        !(a.set in state) ||
        !("value" in a) ||
        typeof a.value !== typeof state[a.set]
      ) {
        issue(
          "action-adapter",
          "Button needs a supported typed local set action",
          path,
        );
        return "";
      }
      const id =
        typeof a.id === "string" ? a.id : "migration-binding-" + ++sequence;
      a.id = id;
      bindings.push({ id, field: a.set, kind: "set", value: a.value });
      delete a.set;
      delete a.value;
      a.type = "button";
      result.capabilities.push("local-action");
    } else if (!/^[a-z][\w-]*$/.test(name)) {
      issue("component", "Component needs a functional adapter: " + name, path);
      return "";
    }
    if (
      "run" in a ||
      "set" in a ||
      ("source" in a && String(a.source).startsWith("$"))
    )
      issue("binding", "Element has unsupported reactive behavior", path);
    if (typeof a.id === "string") {
      if (Object.hasOwn(result.identities, a.id))
        issue("identity", "Duplicate source identity", path);
      result.identities[a.id] = a.id;
      a["data-af-id"] = a.id;
    }
    const attributes = Object.entries(a)
      .map(([k, v]) => {
        const key = k === "className" ? "class" : k === "htmlFor" ? "for" : k;
        if (typeof v === "boolean") return v ? ` ${key}` : "";
        return ` ${key}="${esc(v)}"`;
      })
      .join("");
    const children = node.children
      .map((c: Node, i: number) => render(c, path + "." + i, inHead))
      .join("");
    if (inHead && !["title", "meta", "link", "base"].includes(tag))
      issue("head", "Unsupported Helmet declaration: " + tag, path);
    return `<${tag}${attributes}>${voids.has(tag) ? "" : children + `</${tag}>`}`;
  }
  const body = render(root, "root");
  if (result.issues.length)
    return { ...result, classification: "manual-blocked" };
  for (const css of styles)
    if (/<\/style/i.test(css))
      issue("style", "Unsafe stylesheet closing sequence", "styles");
  if (result.issues.length)
    return { ...result, classification: "manual-blocked" };
  const fields = Object.keys(state);
  const script = bindings.length
    ? `<script type="module">import {client,gql} from '@afbin/apollo';\nconst query=gql\`{ ${fields.join(" ")} }\`;const bindings=${json(bindings)};\nclient.watchQuery({query}).subscribe(({data})=>{for(const b of bindings){if(b.kind==='text'){const el=document.querySelector('[data-af-id="'+b.id+'"]');if(el)el.textContent=String(data[b.field]??'');}}});\nfor(const b of bindings){if(b.kind==='set'){document.querySelector('[data-af-id="'+b.id+'"]').addEventListener('click',()=>client.updateQuery({query},data=>({...data,[b.field]:b.value})));}}\n</script>`
    : "";
  result.classification = bindings.length ? "functional" : "renderable";
  result.html = `<!doctype html><html${input.designSystem ? ` data-af-design-system="${esc(input.designSystem)}"` : ""}><head><script src="${esc(input.coreUrl)}" data-af="core"></script><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head.join("")}${styles.map((s) => `<style>${s}</style>`).join("")}${fields.length ? `<script type="application/json" data-af="state">${json(state)}</script>` : ""}</head><body>${body}${script}</body></html>`;
  return result;
}
/** Reconstruct canonical graph source using the archived graphSource contract.
 * Source fragments are authoritative; ast fields and sibling positions are not identities.
 */
export function legacyDocumentSource(document: unknown): string {
  if (!document || typeof document !== "object")
    throw new Error("Missing canonical document");
  const graph = document as {
    kind?: unknown;
    schema?: unknown;
    nodes?: unknown;
  };
  if (
    graph.kind !== "graph" ||
    graph.schema !== 3 ||
    !graph.nodes ||
    typeof graph.nodes !== "object" ||
    Array.isArray(graph.nodes)
  )
    throw new Error("Expected canonical document graph schema 3");
  const nodes = graph.nodes as Record<string, unknown>;
  const seen = new Set<string>();
  const visit = (key: string, depth: number): string => {
    if (depth > 512)
      throw new Error("Canonical graph nesting exceeds migration limit");
    if (seen.has(key))
      throw new Error("Canonical graph contains a cycle or repeated child");
    seen.add(key);
    if (!Object.hasOwn(nodes, key))
      throw new Error("Canonical graph references a missing child");
    const node = nodes[key] as { parts?: unknown; children?: unknown };
    if (
      !node ||
      typeof node !== "object" ||
      !Array.isArray(node.parts) ||
      !node.parts.every((p) => typeof p === "string") ||
      !Array.isArray(node.children) ||
      !node.children.every((c) => typeof c === "string")
    )
      throw new Error("Invalid canonical graph node");
    const parts = node.parts as string[],
      children = node.children as string[];
    if (parts.length !== children.length + 1)
      throw new Error("Invalid canonical source boundaries");
    return (
      parts[0]! +
      children
        .map((child, index) => visit(child, depth + 1) + parts[index + 1]!)
        .join("")
    );
  };
  return visit("$root", 0);
}
export function convertLegacyDocument(
  document: unknown,
  input: Omit<ConversionInput, "source">,
): ConversionResult {
  try {
    return convertLegacyJsx({
      ...input,
      source: legacyDocumentSource(document),
    });
  } catch (error) {
    return {
      classification: "manual-blocked",
      html: null,
      identities: {},
      capabilities: [],
      issues: [
        {
          code: "document-codec",
          message:
            error instanceof Error
              ? error.message
              : "Invalid canonical document graph",
          path: "root",
        },
      ],
    };
  }
}
