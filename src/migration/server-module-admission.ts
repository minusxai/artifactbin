import { Parser } from "acorn";
import type { LegacyServerDeclarations } from "./server-module-contracts.ts";
const forbidden = new Set([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "importScripts",
  "sendBeacon",
  "eval",
  "Function",
  "globalThis",
  "window",
  "self",
  "navigator",
  "process",
  "require",
  "Deno",
  "constructor",
  "__proto__",
]);
const validName = (name: unknown): name is string =>
  typeof name === "string" &&
  /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(name) &&
  !["constructor", "prototype", "__proto__"].includes(name);
/** Conservative compatibility gate, not a substitute for the backend isolate. */
export function admitLegacyServerModule(
  source: string,
  declarations: LegacyServerDeclarations,
): LegacyServerDeclarations {
  if (
    typeof source !== "string" ||
    new TextEncoder().encode(source).length > 1024 * 1024
  )
    throw Error("Invalid server module source");
  const known = new Map<string, Set<string>>();
  for (const kind of ["values", "queries", "mutations"] as const) {
    const names = declarations[kind];
    if (
      !Array.isArray(names) ||
      names.length > 1024 ||
      names.some((name) => !validName(name)) ||
      new Set(names).size !== names.length
    )
      throw Error("Invalid server declarations");
    known.set(kind, new Set(names));
  }
  const tree = Parser.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as any;
  const imported = new Map<string, "signal" | "query" | "mutation">();
  let defaults = 0;
  for (const node of tree.body) {
    if (node.type === "ImportDeclaration") {
      if (node.source.value !== "page" || !node.specifiers.length)
        throw Error("Unsupported server import");
      for (const spec of node.specifiers) {
        const name = spec.imported?.name;
        if (
          spec.type !== "ImportSpecifier" ||
          !["signal", "query", "mutation"].includes(name)
        )
          throw Error("Unsupported server page import");
        imported.set(spec.local.name, name);
      }
    } else if (node.type === "ExportDefaultDeclaration") {
      defaults++;
      const fn = node.declaration;
      if (
        fn.type !== "FunctionDeclaration" ||
        !fn.async ||
        fn.generator ||
        fn.params.length > 1 ||
        fn.params.some((param: any) => param.type !== "Identifier")
      )
        throw Error("Unsupported server default handler");
    } else if (node.type.startsWith("Export"))
      throw Error("Unsupported server export");
  }
  if (defaults !== 1) throw Error("One default server handler is required");
  const used = {
    values: new Set<string>(),
    queries: new Set<string>(),
    mutations: new Set<string>(),
  };
  const walk = (node: any, parent?: any, key?: string) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "ImportExpression")
      throw Error("Dynamic server imports are unsupported");
    if (
      node.type === "Identifier" &&
      (forbidden.has(node.name) || node.name.startsWith("__legacyServer"))
    )
      throw Error("Unsupported server capability");
    if (
      node.type === "Literal" &&
      typeof node.value === "string" &&
      forbidden.has(node.value)
    )
      throw Error("Unsupported server capability");
    if (
      node.type === "Identifier" &&
      imported.has(node.name) &&
      parent?.type !== "ImportSpecifier"
    ) {
      if (
        parent?.type !== "CallExpression" ||
        key !== "callee" ||
        parent.arguments.length !== 1 ||
        parent.arguments[0].type !== "Literal" ||
        typeof parent.arguments[0].value !== "string" ||
        !/^\$[A-Za-z][A-Za-z0-9_]*$/.test(parent.arguments[0].value)
      )
        throw Error("Server page bindings require literal declared references");
      const kind = (
        { signal: "values", query: "queries", mutation: "mutations" } as const
      )[imported.get(node.name)!];
      const name = parent.arguments[0].value.slice(1);
      if (!known.get(kind)!.has(name))
        throw Error("Undeclared server page binding");
      used[kind].add(name);
    }
    for (const [childKey, value] of Object.entries(node)) {
      if (Array.isArray(value))
        for (const child of value) walk(child, node, childKey);
      else if (value && typeof value === "object") walk(value, node, childKey);
    }
  };
  walk(tree);
  return {
    values: [...used.values],
    queries: [...used.queries],
    mutations: [...used.mutations],
  };
}
