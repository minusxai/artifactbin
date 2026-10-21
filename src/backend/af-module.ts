/**
 * Static reading of a backend file (contract: ./af-backend-contracts.ts).
 * Nothing here runs the author's code: Node's built-in type stripping turns
 * the TypeScript into JavaScript and acorn reads the module's shape. Both are
 * available in the production image (no devDependencies).
 */
import { stripTypeScriptTypes } from "node:module";
import { parse } from "acorn";
import {
  BackendModuleError,
  type BackendModuleInfo,
} from "./af-backend-contracts.ts";
import { boundedBackendSchema } from "../graphql/execution-policy.ts";
import { importKind, moduleImports, pinAdvice } from "./packages.ts";

/** The platform's module; compilation maps it to a built-in shim. npm packages and built-ins: ./packages.ts. */
export const BACKEND_IMPORT = "@afbin/apollo";

// acorn's ESTree nodes, as far as this reader uses them.
interface Node {
  type: string;
  [key: string]: unknown;
}
interface TemplateElement extends Node {
  value: { raw: string; cooked: string | null | undefined };
}

function toJavaScript(source: string): string {
  try {
    return stripTypeScriptTypes(source, { mode: "strip" });
  } catch {
    // Enums and namespaces are not erasable; transform them instead.
    return stripTypeScriptTypes(source, { mode: "transform" });
  }
}

const nameOf = (node: unknown): string | undefined => {
  const n = node as Node | undefined;
  if (n?.type === "Identifier") return n.name as string;
  if (n?.type === "Literal" && typeof n.value === "string") return n.value;
  return undefined;
};

/** The string a `typeDefs` initializer evaluates to, when it is static. */
function staticString(init: Node | null | undefined): string | undefined {
  if (!init) return undefined;
  if (init.type === "Literal")
    return typeof init.value === "string" ? init.value : undefined;
  const template = (node: Node) => {
    const quasis = node.quasis as TemplateElement[];
    const expressions = node.expressions as Node[];
    const cooked = quasis[0]?.value.cooked;
    return expressions.length === 0 &&
      quasis.length === 1 &&
      typeof cooked === "string"
      ? cooked
      : undefined;
  };
  if (init.type === "TemplateLiteral") return template(init);
  if (
    init.type === "TaggedTemplateExpression" &&
    nameOf(init.tag) === "gql" &&
    (init.tag as Node).type === "Identifier"
  )
    return template(init.quasi as Node);
  return undefined;
}

export async function readBackendModule(
  source: string,
): Promise<BackendModuleInfo> {
  if (typeof source !== "string")
    throw new BackendModuleError("typedefs-missing", "A backend file is text");
  let program: Node;
  try {
    program = parse(toJavaScript(source), {
      ecmaVersion: "latest",
      sourceType: "module",
    }) as unknown as Node;
  } catch (error) {
    throw new BackendModuleError(
      "typedefs-missing",
      `The backend file could not be read: ${error instanceof Error ? error.message : "syntax error"}`,
    );
  }
  const body = program.body as Node[];

  const { specifiers: imports, computed: dynamicImport } = moduleImports(source, true);
  const unpinned = imports.find((s) => importKind(s) === "unpinned");
  if (unpinned)
    throw new BackendModuleError(
      "import-not-allowed",
      `Backend files import npm packages at an exact version: ${pinAdvice(unpinned)}`,
    );
  const refused = imports.filter((s) => importKind(s) === "refused");
  if (dynamicImport || refused.length)
    throw new BackendModuleError(
      "import-not-allowed",
      `Backend files may import ${BACKEND_IMPORT}, npm packages at an exact version ("pg@8.13.1") and node: built-ins${refused.length ? `, not ${refused.join(", ")}` : ", and only by name"}`,
    );

  // export const typeDefs = …   or   const t = …; export { t as typeDefs }
  const declarations = new Map<string, { kind: string; init: Node | null }>();
  for (const statement of body) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? (statement.declaration as Node | null)
        : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations as Node[]) {
      const name = nameOf(declarator.id);
      if (name)
        declarations.set(name, {
          kind: declaration.kind as string,
          init: declarator.init as Node | null,
        });
    }
  }
  let typeDefsLocal: string | undefined;
  let hasDefault = false;
  for (const statement of body) {
    if (statement.type === "ExportDefaultDeclaration") hasDefault = true;
    if (statement.type !== "ExportNamedDeclaration" || statement.source)
      continue;
    const declaration = statement.declaration as Node | null;
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations as Node[])
        if (nameOf(declarator.id) === "typeDefs") typeDefsLocal = "typeDefs";
    } else if (declaration && nameOf(declaration.id) === "typeDefs") {
      throw new BackendModuleError(
        "typedefs-not-static",
        "typeDefs must be a string or a gql template without ${…}",
      );
    }
    for (const specifier of (statement.specifiers as Node[] | undefined) ??
      []) {
      const exported = nameOf(specifier.exported);
      if (exported === "default") hasDefault = true;
      if (exported === "typeDefs") typeDefsLocal = nameOf(specifier.local);
    }
  }
  if (typeDefsLocal === undefined)
    throw new BackendModuleError(
      "typedefs-missing",
      "A backend file must export const typeDefs",
    );
  const declared = declarations.get(typeDefsLocal);
  const typeDefs =
    declared?.kind === "const" ? staticString(declared.init) : undefined;
  if (typeDefs === undefined)
    throw new BackendModuleError(
      "typedefs-not-static",
      "typeDefs must be a const string or a gql template without ${…}",
    );
  if (!hasDefault)
    throw new BackendModuleError(
      "default-export-missing",
      "A backend file must export default { Query, Mutation } resolvers",
    );
  try {
    boundedBackendSchema(typeDefs);
  } catch (error) {
    throw new BackendModuleError(
      "schema-invalid",
      `The backend schema is invalid: ${error instanceof Error ? error.message : "invalid"}`,
    );
  }
  return { typeDefs, imports };
}
