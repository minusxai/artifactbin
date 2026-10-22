import { Parser } from "acorn";
import jsx from "acorn-jsx";
const parser = Parser.extend(jsx());
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
  "constructor",
  "__proto__",
]);
/** Conservative offline capability admission, before the archived text compiler runs. */
export function admitAuthorSource(source: string): void {
  const ast = parser.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as unknown as Record<string, unknown>;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const n = node as Record<string, any>;
    if (n.type === "ImportExpression")
      throw Error("Dynamic imports are unsupported");
    if (n.type === "ImportDeclaration") {
      const spec = n.source.value;
      if (
        !["page", "solid-js", "solid-js/web", "solid-js/store"].includes(spec)
      )
        throw Error("External author packages are unsupported");
      if (
        spec === "page" &&
        n.specifiers.some(
          (s: any) =>
            s.type !== "ImportSpecifier" ||
            !["signal", "query", "mutation"].includes(
              s.imported.name ?? s.imported.value,
            ),
        )
      )
        throw Error("Only page signal, query and mutation are supported");
    }
    if (
      (n.type === "ExportNamedDeclaration" ||
        n.type === "ExportAllDeclaration") &&
      n.source
    )
      throw Error("Author re-exports are unsupported");
    if (n.type === "Identifier" && forbidden.has(n.name))
      throw Error("Unsupported author capability: " + n.name);
    if (
      n.type === "Literal" &&
      typeof n.value === "string" &&
      forbidden.has(n.value)
    )
      throw Error("Unsupported author capability: " + n.value);
    for (const [key, value] of Object.entries(n))
      if (!["start", "end", "loc"].includes(key)) visit(value);
  };
  visit(ast);
}
