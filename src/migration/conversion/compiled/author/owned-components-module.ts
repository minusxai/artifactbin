import { Parser } from "acorn";
import type { PreparedOwnedAuthorComponents } from "./effect-source-contracts.ts";
/** Archive compilation is syntax-only; the initializer executes once in the browser-owned module root. */
export function ownedComponentInitializerModule(
  compiled: string,
  plan: PreparedOwnedAuthorComponents,
): string {
  const ast = Parser.parse(compiled, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as any;
  const imports: string[] = [],
    body: string[] = [],
    exports = new Map<string, string>();
  for (const node of ast.body) {
    if (node.type === "ImportDeclaration") {
      imports.push(compiled.slice(node.start, node.end));
      continue;
    }
    if (node.type === "ExportNamedDeclaration") {
      if (node.source) throw Error("Unexpected owned component re-export");
      if (node.declaration) {
        const declaration = node.declaration;
        body.push(compiled.slice(declaration.start, declaration.end));
        const declarations =
          declaration.type === "VariableDeclaration"
            ? declaration.declarations
            : [declaration];
        for (const item of declarations) {
          if (item.id?.type !== "Identifier")
            throw Error("Unexpected owned component export binding");
          exports.set(item.id.name, item.id.name);
        }
      } else
        for (const specifier of node.specifiers) {
          if (
            specifier.local?.type !== "Identifier" ||
            specifier.exported?.type !== "Identifier" ||
            exports.has(specifier.exported.name)
          )
            throw Error("Unexpected owned component export alias");
          exports.set(specifier.exported.name, specifier.local.name);
        }
    } else if (node.type.startsWith("Export"))
      throw Error("Unexpected owned component export");
    else body.push(compiled.slice(node.start, node.end));
  }
  if (
    exports.size !== plan.exports.length ||
    plan.exports.some((name) => !exports.has(name))
  )
    throw Error("Owned component compiler export manifest changed");
  return `import {getAuthorPorts} from 'author-closure';\n${imports.join("\n")}\nexport function initialize(${plan.lifetimeIdentifier},${plan.windowIdentifier}){\n${body.join("\n")}\nreturn Object.freeze({${plan.exports.map((name) => JSON.stringify(name) + ":" + exports.get(name)).join(",")}});\n}`;
}
