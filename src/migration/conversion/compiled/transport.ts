import { parse } from "acorn";
import { SourceMap } from "node:module";
import { sanitizeMermaidSvg } from "./mermaid-svg.ts";
import { admitMermaid } from "./mermaid-admission.ts";
import type { ValidateCompiledTransport } from "./transport-contracts.ts";
const forbidden = /\/api\/|\/islands\/|EventSource|WebSocket|@mx\/boot/;
const fail = (): never => {
  throw Error("Legacy platform transport in browser bundle");
};
const walk = (
  node: any,
  visit: (node: any, parent: any) => void,
  parent?: any,
): void => {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(value)) value.forEach((v) => walk(v, visit, node));
    else if (value && typeof value === "object") walk(value, visit, node);
  }
};
const literal = (node: any): string | undefined =>
  node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : node?.type === "TemplateLiteral" && node.expressions.length === 0
      ? node.quasis[0].value.cooked
      : undefined;
const key = (property: any) =>
  property?.type === "Property" &&
  !property.computed &&
  property.kind === "init" &&
  !property.method
    ? (property.key.name ?? property.key.value)
    : undefined;
function properties(node: any): Map<string, any> | undefined {
  if (node?.type !== "ObjectExpression") return;
  const out = new Map<string, any>();
  for (const p of node.properties) {
    const name = key(p);
    if (typeof name !== "string" || out.has(name)) return;
    out.set(name, p.value);
  }
  return out;
}
function data(node: any): any {
  if (
    (node?.type === "Literal" &&
      ["string", "number", "boolean"].includes(typeof node.value)) ||
    (node?.type === "Literal" && node.value === null)
  )
    return node.value;
  if (node?.type === "TemplateLiteral" && !node.expressions.length)
    return literal(node);
  if (
    node?.type === "UnaryExpression" &&
    node.operator === "-" &&
    typeof node.argument.value === "number"
  )
    return -node.argument.value;
  if (node?.type === "ArrayExpression" && node.elements.every(Boolean))
    return node.elements.map(data);
  const props = properties(node);
  if (props) {
    const out = Object.create(null);
    for (const [name, value] of props) {
      if (name === "__proto__") fail();
      out[name] = data(value);
    }
    return out;
  }
  return fail();
}
function folded(node: any): string | undefined {
  const value = literal(node);
  if (value !== undefined) return value;
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const a = folded(node.left),
      b = folded(node.right);
    if (a !== undefined && b !== undefined) return a + b;
  }
  if (node.type === "TemplateLiteral") {
    let text = "";
    for (let i = 0; i < node.quasis.length; i++) {
      text += node.quasis[i].value.cooked ?? "";
      if (i < node.expressions.length) {
        const v = folded(node.expressions[i]);
        if (v === undefined) return;
        text += v;
      }
    }
    return text;
  }
  return;
}
const ast = (source: string) =>
  parse(source, { ecmaVersion: "latest", sourceType: "module" }) as any;
interface Approved {
  source: string;
  start: number;
  end: number;
  id: string;
  text: string;
  kind: "code" | "svg";
}
function hasName(pattern: any, name: string): boolean {
  if (!pattern) return false;
  if (pattern.type === "Identifier") return pattern.name === name;
  let found = false;
  walk(pattern, (n) => {
    if (n.type === "Identifier" && n.name === name) found = true;
  });
  return found;
}
function immutable(tree: any, name: string, ownDeclaration: any): void {
  walk(tree, (node) => {
    if (node === ownDeclaration) return;
    if (
      node.type === "ImportSpecifier" ||
      node.type === "ImportDefaultSpecifier" ||
      node.type === "ImportNamespaceSpecifier"
    ) {
      if (node.local.name === name) fail();
    }
    if (node.type === "VariableDeclarator" && hasName(node.id, name)) fail();
    if (
      /Function/.test(node.type) &&
      (node.id?.name === name || node.params.some((p: any) => hasName(p, name)))
    )
      fail();
    if (
      ((node.type === "ClassDeclaration" || node.type === "ClassExpression") &&
        node.id?.name === name) ||
      (node.type === "CatchClause" && hasName(node.param, name))
    )
      fail();
    if (
      (node.type === "AssignmentExpression" && hasName(node.left, name)) ||
      (node.type === "UpdateExpression" && hasName(node.argument, name)) ||
      (node.type === "UnaryExpression" &&
        node.operator === "delete" &&
        hasName(node.argument, name))
    )
      fail();
  });
}
/** No generic literal exceptions: roots and renderer imports are compiler-owned. */
function approvedOrigins(
  input: NonNullable<Parameters<ValidateCompiledTransport>[0]["mermaid"]>,
): Approved[] {
  const { entry, runtime, plans } = input;
  if (
    !plans.length ||
    plans.length > 32 ||
    new Set(plans.map((p) => p.id)).size !== plans.length
  )
    fail();
  plans.forEach(({ id, code, title, className }) =>
    admitMermaid({ id, code, title, className }),
  );
  const exact = new Map(plans.map((p) => [p.id, p.code])),
    approved: Approved[] = [];
  const add = (source: string, object: any) => {
    const props = properties(object),
      id = literal(props?.get("id")),
      code = literal(props?.get("code"));
    if (id === undefined || code === undefined || exact.get(id) !== code)
      fail();
    const value = props!.get("code");
    approved.push({
      source,
      start: value.start,
      end: value.end,
      id: id!,
      text: code!,
      kind: "code",
    });
  };
  const runtimeTree = ast(runtime.source);
  let planRoot: any;
  for (const statement of runtimeTree.body)
    if (statement.type === "VariableDeclaration" && statement.kind === "const")
      for (const declaration of statement.declarations)
        if (
          declaration.id.type === "Identifier" &&
          declaration.id.name === "plans"
        ) {
          if (planRoot) fail();
          planRoot = declaration;
        }
  if (
    !planRoot ||
    JSON.stringify(data(planRoot.init)) !== JSON.stringify(plans)
  )
    fail();
  immutable(runtimeTree, "plans", planRoot);
  for (const object of planRoot.init.elements) {
    add(runtime.name, object);
    const rootProps = properties(object)!,
      id = literal(rootProps.get("id"))!,
      variants = properties(rootProps.get("variants"));
    for (const mode of ["light", "dark"]) {
      const variant = properties(variants?.get(mode)),
        svgNode = variant?.get("svg"),
        svg = literal(svgNode);
      if (svg === undefined || sanitizeMermaidSvg(svg).svg !== svg) fail();
      approved.push({
        source: runtime.name,
        start: svgNode.start,
        end: svgNode.end,
        id,
        text: svg!,
        kind: "svg",
      });
    }
  }
  const entryTree = ast(entry.source);
  let mermaid: any, component: any;
  for (const statement of entryTree.body)
    if (statement.type === "ImportDeclaration")
      for (const specifier of statement.specifiers) {
        if (specifier.type !== "ImportSpecifier") continue;
        if (
          statement.source.value === "@mx/kit/mermaid" &&
          specifier.imported.name === "Mermaid"
        ) {
          if (mermaid) fail();
          mermaid = specifier;
        }
        if (
          statement.source.value === "@mx/rt" &&
          specifier.imported.name === "createComponent"
        ) {
          if (component) fail();
          component = specifier;
        }
      }
  if (!mermaid || !component) fail();
  immutable(entryTree, mermaid.local.name, mermaid);
  immutable(entryTree, component.local.name, component);
  const matched = new Set<string>();
  walk(entryTree, (node) => {
    if (
      node.type !== "CallExpression" ||
      node.callee.type !== "Identifier" ||
      node.callee.name !== component.local.name ||
      node.arguments[0]?.type !== "Identifier" ||
      node.arguments[0].name !== mermaid.local.name
    )
      return;
    if (node.arguments.length !== 2) fail();
    add(entry.name, node.arguments[1]);
    matched.add(approved.at(-1)!.id);
  });
  if (plans.some((p) => !matched.has(p.id))) fail();
  return approved;
}
const starts = (s: string) => {
  const out = [0];
  for (let i = 0; i < s.length; i++) if (s[i] === "\n") out.push(i + 1);
  return out;
};
function position(lines: number[], offset: number): [number, number] {
  let lo = 0,
    hi = lines.length;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]! <= offset) lo = mid;
    else hi = mid;
  }
  return [lo, offset - lines[lo]!];
}
/** Reject malformed VLQ rather than relying on permissive consumer recovery. */
function validMap(map: any): void {
  if (
    map?.version !== 3 ||
    map.sourceRoot ||
    !Array.isArray(map.sources) ||
    new Set(map.sources).size !== map.sources.length ||
    !Array.isArray(map.sourcesContent) ||
    map.sourcesContent.length !== map.sources.length ||
    map.sources.some((s: any) => typeof s !== "string") ||
    map.sourcesContent.some((s: any) => typeof s !== "string") ||
    typeof map.mappings !== "string" ||
    !/^[A-Za-z0-9+/;,]*$/.test(map.mappings)
  )
    fail();
  const contentLines = map.sourcesContent.map((source: string) =>
    source.split("\n"),
  );
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let source = 0,
    line = 0,
    column = 0;
  for (const row of map.mappings.split(";")) {
    let generated = 0;
    for (const segment of row.split(",")) {
      if (!segment) continue;
      const values: number[] = [];
      let value = 0,
        shift = 0,
        open = false;
      for (const char of segment) {
        const digit = chars.indexOf(char);
        value += (digit & 31) * 2 ** shift;
        if (!Number.isSafeInteger(value) || shift > 30) fail();
        open = !!(digit & 32);
        if (open) shift += 5;
        else {
          values.push(
            value & 1 ? -Math.floor(value / 2) : Math.floor(value / 2),
          );
          value = 0;
          shift = 0;
        }
      }
      if (open || ![1, 4, 5].includes(values.length)) fail();
      if (values[0]! < 0) fail();
      generated += values[0]!;
      if (!Number.isSafeInteger(generated)) fail();
      if (values.length > 1) {
        source += values[1]!;
        line += values[2]!;
        column += values[3]!;
        if (
          source < 0 ||
          source >= map.sources.length ||
          line < 0 ||
          column < 0
        )
          fail();
        const lines = contentLines[source];
        if (line >= lines.length || column > lines[line].length) fail();
      }
    }
  }
}
export const validateCompiledTransport: ValidateCompiledTransport = (input) => {
  if (input.javascript.length > 20e6 || (input.sourceMap?.length ?? 0) > 64e6)
    fail();
  const tree = ast(input.javascript),
    allowed = new Set<any>();
  if (input.mermaid) {
    if (!input.sourceMap) fail();
    const origins = approvedOrigins(input.mermaid),
      map = JSON.parse(input.sourceMap!),
      sources = new Map([
        [input.mermaid.entry.name, input.mermaid.entry.source],
        [input.mermaid.runtime.name, input.mermaid.runtime.source],
      ]);
    validMap(map);
    for (const [name, source] of sources) {
      const index = map.sources.indexOf(name);
      if (index < 0 || map.sourcesContent[index] !== source) fail();
    }
    const parents = new Map<any, any>();
    walk(tree, (node, parent) => parents.set(node, parent));
    const consumer = new SourceMap(map),
      generatedLines = starts(input.javascript),
      sourceLines = new Map(
        [...sources].map(([name, source]) => [name, starts(source)]),
      );
    walk(tree, (node, parent) => {
      const text = literal(node),
        kind = key(parent);
      if (
        text === undefined ||
        !forbidden.test(text) ||
        (kind !== "code" && kind !== "svg")
      )
        return;
      let object = parents.get(parent);
      if (kind === "svg") {
        const modeProperty = parents.get(object),
          variantsObject = parents.get(modeProperty),
          variantsProperty = parents.get(variantsObject);
        if (
          !["light", "dark"].includes(key(modeProperty)) ||
          key(variantsProperty) !== "variants"
        )
          return;
        object = parents.get(variantsProperty);
      }
      const props = properties(object),
        id = literal(props?.get("id"));
      if (id === undefined) return;
      const candidates = origins.filter(
        (o) => o.id === id && o.text === text && o.kind === kind,
      );
      if (!candidates.length) return;
      let origin: Approved | undefined;
      for (let offset = node.start; offset < node.end; offset++) {
        const [line, column] = position(generatedLines, offset),
          entry = consumer.findEntry(line, column) as any;
        if (
          entry.generatedLine !== line ||
          typeof entry.originalSource !== "string"
        )
          return;
        const lines = sourceLines.get(entry.originalSource);
        if (
          !lines ||
          entry.originalLine < 0 ||
          entry.originalLine >= lines.length
        )
          return;
        const original = lines[entry.originalLine]! + entry.originalColumn;
        const next = candidates.find(
          (o) =>
            o.source === entry.originalSource &&
            original >= o.start &&
            original < o.end,
        );
        if (!next || (origin && next !== origin)) return;
        origin = next;
      }
      if (origin) allowed.add(node);
    });
  }
  const spans = [...allowed]
    .map((n) => [n.start, n.end] as const)
    .sort((a, b) => a[0] - b[0]);
  let scanned = "",
    last = 0;
  for (const [start, end] of spans) {
    scanned += input.javascript.slice(last, start) + " ".repeat(end - start);
    last = end;
  }
  scanned += input.javascript.slice(last);
  if (forbidden.test(scanned)) fail();
  walk(tree, (node) => {
    if (allowed.has(node)) return;
    const value = folded(node);
    if (value !== undefined && forbidden.test(value)) fail();
  });
};
