import { Parser } from "acorn";
import type { PreparedAuthorEffects } from "./effect-source-contracts.ts";
/** Only trusted dependency imports run during module loading; authored statements run in an owned root. */
export function effectInitializerModule(
  compiled: string,
  plan: PreparedAuthorEffects,
): string {
  const ast = Parser.parse(compiled, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as any;
  const imports: string[] = [],
    body: string[] = [];
  for (const node of ast.body) {
    if (node.type === "ImportDeclaration")
      imports.push(compiled.slice(node.start, node.end));
    else if (
      node.type === "ExportNamedDeclaration" &&
      !node.declaration &&
      !node.specifiers.length
    )
      continue;
    else if (node.type.startsWith("Export"))
      throw Error("Unexpected effects compiler exports");
    else body.push(compiled.slice(node.start, node.end));
  }
  return `import {getAuthorPorts} from 'author-closure';\n${imports.join("\n")}\nexport function initialize(${plan.lifetimeIdentifier},${plan.windowIdentifier}){\n${body.join("\n")}\n}`;
}
