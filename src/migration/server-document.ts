import { createHash } from "node:crypto";
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import type { PrepareInactiveServerDocument } from "./server-document-contracts.ts";
const hash = (source: string) =>
  createHash("sha256").update(source).digest("hex");
const literal = (node: any): unknown =>
  node?.type === "Literal"
    ? node.value
    : node?.type === "JSXExpressionContainer"
      ? literal(node.expression)
      : node?.type === "TemplateLiteral" && !node.expressions.length
        ? node.quasis[0].value.cooked
        : undefined;
/** Pure, explicit migration representation. No compiler, handler, transport or renderer is invoked.
 * The caller retains the original in the existing archive, admits renderSource independently,
 * and must render the limitation before any eventual body rendering can claim completeness. */
export const prepareInactiveServerDocument: PrepareInactiveServerDocument = (
  source,
  options,
) => {
  if (
    options?.mode !== "archived-inactive" ||
    typeof source !== "string" ||
    Buffer.byteLength(source) > 8 * 1024 * 1024
  )
    throw Error("inactive_server_document_invalid");
  let tree: any;
  try {
    tree = Parser.extend(jsx()).parse("<>" + source + "</>", {
      ecmaVersion: "latest",
      sourceType: "module",
    });
  } catch {
    throw Error("inactive_server_document_invalid");
  }
  const parents = new WeakMap<object, any>(),
    scripts: any[] = [];
  let declaredDatasetMutations = 0,
    mutationControls = 0;
  const visit = (node: any, parent?: any): void => {
    if (!node || typeof node !== "object") return;
    if (parent) parents.set(node, parent);
    if (node.type === "JSXElement") {
      const tag = node.openingElement.name.name;
      if (
        tag === "script" &&
        node.openingElement.attributes.some(
          (a: any) => a.name?.name === "type" && literal(a.value) === "server",
        )
      )
        scripts.push(node);
      if (tag === "Mutation" && parent?.openingElement?.name?.name === "Helmet")
        declaredDatasetMutations++;
      if (
        node.openingElement.attributes.some((a: any) => a.name?.name === "run")
      )
        mutationControls++;
    }
    for (const [key, value] of Object.entries(node)) {
      if (["start", "end"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach((n) => visit(n, node));
      else if (value && typeof value === "object") visit(value, node);
    }
  };
  visit(tree);
  if (scripts.length !== 1)
    throw Error("inactive_server_document_requires_one_handler");
  const script = scripts[0],
    helmet = parents.get(script),
    attrs = script.openingElement.attributes;
  if (
    helmet?.openingElement?.name?.name !== "Helmet" ||
    parents.get(helmet)?.type !== "JSXFragment" ||
    attrs.length !== 1 ||
    attrs[0].name?.name !== "type" ||
    literal(attrs[0].value) !== "server"
  )
    throw Error("inactive_server_document_invalid_handler");
  const children = script.children.filter(
    (n: any) => !(n.type === "JSXText" && !n.value.trim()),
  );
  const handler = children.length === 1 ? literal(children[0]) : undefined;
  if (
    typeof handler !== "string" ||
    !handler ||
    Buffer.byteLength(handler) > 1024 * 1024 ||
    /<\/script/i.test(handler)
  )
    throw Error("inactive_server_document_invalid_payload");
  return {
    mode: "archived-inactive",
    originalSourceSha256: hash(source),
    renderSource:
      source.slice(0, script.start - 2) + source.slice(script.end - 2),
    handler: {
      status: "archived-inactive",
      sourceSha256: hash(handler),
      reason: "execution-not-enabled",
    },
    body: { declaredDatasetMutations, mutationControls },
    limitation:
      "Archived server handler is unavailable; execution is not enabled.",
  };
};
