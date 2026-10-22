import { MAX_COMPILED_SOURCE_BYTES } from "./contracts.ts";
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import {
  prepareAuthorEffects,
  prepareOwnedAuthorComponents,
} from "./author/effect-source.ts";
import { admitAuthorSource } from "./author/admission.ts";
import type { AuthorDocumentPlan } from "./author-document-contracts.ts";
const parser = Parser.extend(jsx());
const mountAttributes: Record<string, string> = {
  "data-mx-mount": "data-migration-author-component",
  "data-mx-props": "data-migration-author-props",
  "data-mx-bind": "data-migration-author-bind",
};
function walk(
  node: any,
  visit: (node: any, parent?: any) => void,
  parent?: any,
): void {
  if (!node || typeof node !== "object") return;
  visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (["start", "end"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((v) => walk(v, visit, node));
    else if (value && typeof value === "object") walk(value, visit, node);
  }
}
function literal(node: any): unknown {
  if (node?.type === "Literal") return node.value;
  if (node?.type === "JSXExpressionContainer") return literal(node.expression);
  if (node?.type === "TemplateLiteral" && !node.expressions.length)
    return node.quasis[0]?.value.cooked;
  return undefined;
}
export function prepareAuthorDocument(source: string): AuthorDocumentPlan {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source) > MAX_COMPILED_SOURCE_BYTES
  )
    throw Error("Author document limit");
  const wrapped = "<> " + source + " </>";
  const tree = parser.parseExpressionAt(wrapped, 0, {
    ecmaVersion: "latest",
  }) as any;
  if (tree.end !== wrapped.length) throw Error("Incomplete author document");
  const scripts: any[] = [];
  walk(tree, (node, parent) => {
    if (
      node.type === "JSXElement" &&
      node.openingElement.name.name === "script"
    ) {
      if (
        parent?.type !== "JSXElement" ||
        parent.openingElement.name.name !== "Helmet"
      )
        throw Error("Unsupported script placement");
      scripts.push(node);
    }
  });
  if (scripts.length !== 1) throw Error("One author script is required");
  const script = scripts[0];
  if (
    script.openingElement.attributes.some(
      (a: any) => a.name?.name !== "type" || literal(a.value) !== "module",
    )
  )
    throw Error("Unsupported author script type");
  if (script.children.length !== 1)
    throw Error("Unsupported author script payload");
  const text = literal(script.children[0]);
  if (typeof text !== "string")
    throw Error("Unsupported author script payload");
  const module = parser.parse(text, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as any;
  const exports: string[] = [];
  for (const node of module.body) {
    if (node.type === "ExportDefaultDeclaration")
      throw Error("Default author exports unsupported");
    if (node.type !== "ExportNamedDeclaration") continue;
    const declaration = node.declaration;
    if (
      declaration?.type === "FunctionDeclaration" &&
      /^[A-Z]/.test(declaration.id?.name)
    )
      exports.push(declaration.id.name);
    if (declaration?.type === "VariableDeclaration")
      for (const d of declaration.declarations)
        if (/^[A-Z]/.test(d.id?.name)) {
          if (
            !["FunctionExpression", "ArrowFunctionExpression"].includes(
              d.init?.type,
            )
          )
            throw Error("Author component export must be a function");
          exports.push(d.id.name);
        }
  }
  const effects = !exports.length;
  let windowComponents = false;
  if (!effects)
    walk(module, (node) => {
      if (node.type === "Identifier" && node.name === "window")
        windowComponents = true;
    });
  if (effects) prepareAuthorEffects(text);
  else if (windowComponents) {
    const plan = prepareOwnedAuthorComponents(text);
    if (
      plan.exports.length !== exports.length ||
      exports.some((name) => !plan.exports.includes(name))
    )
      throw Error("Owned author export manifest changed");
  } else admitAuthorSource(text);
  const mounts: AuthorDocumentPlan["author"]["mounts"] = [];
  const identities = new Set<string>();
  const elements = (node: any, inside = false) => {
    if (node.type === "JSXElement") {
      const custom = exports.includes(node.openingElement.name.name);
      if (custom) {
        if (inside) throw Error("Nested author mounts unsupported");
        const attr = node.openingElement.attributes.find(
          (a: any) => a.name?.name === "id",
        );
        const identity = literal(attr?.value);
        if (
          typeof identity !== "string" ||
          !identity ||
          identity.length > 256 ||
          identities.has(identity)
        )
          throw Error("A unique stable author mount identity is required");
        identities.add(identity);
        mounts.push({ identity, component: node.openingElement.name.name });
      }
      for (const child of node.children) elements(child, inside || custom);
    } else if (node.type === "JSXFragment")
      for (const child of node.children) elements(child, inside);
  };
  elements(tree);
  if (!effects && !mounts.length) throw Error("No supported author mounts");
  const start = script.start - 3,
    end = script.end - 3;
  return {
    source: source.slice(0, start) + source.slice(end),
    author: {
      script: text,
      exports,
      mounts,
      ...(effects ? { mode: "effects" as const } : {}),
      ...(windowComponents ? { lifecycle: "owned" as const } : {}),
    },
  };
}
/** Rewrite syntax-owned attributes, never arbitrary literal text or author code. */
export function rewriteCompiledMounts(source: string): string {
  const ast = parser.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as any;
  const edits: { start: number; end: number; text: string }[] = [];
  walk(ast, (node) => {
    if (node.type === "JSXAttribute" && mountAttributes[node.name?.name])
      edits.push({
        start: node.name.start,
        end: node.name.end,
        text: mountAttributes[node.name.name]!,
      });
  });
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}
export const compiledAuthorMountAttributes = mountAttributes;
