import { parse } from "acorn";
import type { RuntimeModuleImportAdmission } from "./runtime-module-import-contracts";
interface Ast {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}
interface Entry {
  node: Ast;
  parent?: Ast;
  ancestors: readonly Ast[];
}
const ast = (value: unknown): Ast | undefined =>
  value && typeof value === "object" && typeof (value as Ast).type === "string"
    ? (value as Ast)
    : undefined;
const identifier = (node: Ast | undefined, name?: string) =>
  node?.type === "Identifier" &&
  typeof node.name === "string" &&
  (name === undefined || node.name === name);
const args = (node: Ast) =>
  Array.isArray(node.arguments) ? node.arguments.map(ast) : [];
const runtimeUrl = (value: unknown): value is string =>
  typeof value === "string" && /^(?:data|blob):/.test(value);
/** The guard is independent of mutable URL/Array/String/RegExp methods and never coerces a value. */
export function runtimeModuleArgument(argument: string): string {
  const prefix = (text: string) =>
    [...text]
      .map(
        (character, index) =>
          `$afModuleUrl[${index}]==="${character}"`,
      )
      .join("&&");
  return `(($afModuleUrl)=>{if(typeof $afModuleUrl!=="string"||!((${prefix("data:")})||(${prefix("blob:")})))throw new TypeError("Computed module imports require an absolute data or blob URL");return $afModuleUrl})(${argument})`;
}
function literal(node: Ast | undefined): string | undefined {
  return node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : undefined;
}
function member(
  node: Ast | undefined,
  object: string,
  property: string,
): boolean {
  return (
    node?.type === "MemberExpression" &&
    node.computed === false &&
    identifier(ast(node.object), object) &&
    identifier(ast(node.property), property)
  );
}
function closedRuntimeUrl(node: Ast | undefined): boolean {
  if (!node) return false;
  const direct = literal(node);
  if (direct !== undefined) return runtimeUrl(direct);
  if (node.type !== "CallExpression" || node.optional) return false;
  const callee = ast(node.callee),
    arguments_ = args(node);
  if (
    callee?.type === "MemberExpression" &&
    callee.computed === false &&
    identifier(ast(callee.property), "join")
  ) {
    const array = ast(callee.object);
    if (
      array?.type !== "ArrayExpression" ||
      !Array.isArray(array.elements) ||
      arguments_.length !== 1
    )
      return false;
    const separator = literal(arguments_[0]),
      values = array.elements.map((value) => literal(ast(value)));
    return (
      separator !== undefined &&
      values.every((value) => value !== undefined) &&
      runtimeUrl((values as string[]).join(separator))
    );
  }
  if (!member(callee, "URL", "createObjectURL") || arguments_.length !== 1)
    return false;
  const blob = arguments_[0];
  if (blob?.type !== "NewExpression" || !identifier(ast(blob.callee), "Blob"))
    return false;
  const parts = args(blob),
    content = parts[0];
  if (
    parts.length < 1 ||
    parts.length > 2 ||
    content?.type !== "ArrayExpression" ||
    !Array.isArray(content.elements) ||
    !content.elements.every((value) => literal(ast(value)) !== undefined)
  )
    return false;
  if (parts.length === 1) return true;
  const options = parts[1];
  if (
    options?.type !== "ObjectExpression" ||
    !Array.isArray(options.properties) ||
    options.properties.length !== 1
  )
    return false;
  const property = ast(options.properties[0]);
  return (
    property?.type === "Property" &&
    property.kind === "init" &&
    !property.method &&
    !property.computed &&
    (identifier(ast(property.key), "type") ||
      literal(ast(property.key)) === "type") &&
    literal(ast(property.value)) === "text/javascript"
  );
}
/** Conservative whole-module proof: a private const adapter cannot escape, be rebound or take a local/unknown URL.
 * Generated guards are recognized exactly so publication rewrites and immutable asset reads are idempotent. */
export function admitRuntimeModuleImports(
  source: string,
): readonly RuntimeModuleImportAdmission[] {
  let tree: Ast;
  try {
    tree = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
    }) as unknown as Ast;
  } catch {
    return [];
  }
  const entries: Entry[] = [];
  const walk = (
    value: unknown,
    parent?: Ast,
    ancestors: readonly Ast[] = [],
  ) => {
    const node = ast(value);
    if (!node) return;
    entries.push({ node, parent, ancestors });
    for (const value of Object.values(node))
      if (Array.isArray(value))
        value.forEach((child) => walk(child, node, [...ancestors, node]));
      else if (value && typeof value === "object")
        walk(value, node, [...ancestors, node]);
  };
  walk(tree);
  const result: RuntimeModuleImportAdmission[] = [];
  for (const entry of entries) {
    const declaration = entry.node,
      id = ast(declaration.id),
      arrow = ast(declaration.init);
    if (
      declaration.type !== "VariableDeclarator" ||
      entry.parent?.type !== "VariableDeclaration" ||
      entry.parent.kind !== "const" ||
      !identifier(id) ||
      arrow?.type !== "ArrowFunctionExpression" ||
      arrow.async ||
      entry.ancestors.some(
        (node) =>
          node.type === "ExportNamedDeclaration" ||
          node.type === "ExportDefaultDeclaration",
      )
    )
      continue;
    const parameters = Array.isArray(arrow.params) ? arrow.params.map(ast) : [],
      body = ast(arrow.body),
      parameter = parameters[0];
    if (
      parameters.length !== 1 ||
      !identifier(parameter) ||
      body?.type !== "ImportExpression" ||
      body.options
    )
      continue;
    const argument = ast(body.source),
      parameterName = String(parameter!.name),
      replacement = runtimeModuleArgument(parameterName);
    if (
      !identifier(argument, parameterName) &&
      (!argument || source.slice(argument.start, argument.end) !== replacement)
    )
      continue;
    let calls = 0,
      invalid = false;
    for (const reference of entries.filter((item) =>
      identifier(item.node, String(id!.name)),
    )) {
      if (reference.node === id) continue;
      if (
        reference.parent?.type !== "CallExpression" ||
        reference.parent.callee !== reference.node ||
        reference.parent.optional
      ) {
        invalid = true;
        break;
      }
      const actual = args(reference.parent);
      if (actual.length !== 1 || !closedRuntimeUrl(actual[0])) {
        invalid = true;
        break;
      }
      calls++;
    }
    if (!invalid && calls && argument)
      result.push({
        importStart: body.start,
        argumentStart: argument.start,
        argumentEnd: argument.end,
        replacement,
      });
  }
  return result;
}
