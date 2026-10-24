import { admitDataColumn } from "../conversion/compiled/data-controls.ts";
import type { RetainedJsxNode } from "./analyze-contracts.ts";
import type { NativeBindingIdentity, NativeBindingTarget, NativeTableColumn } from "./bindings-contracts.ts";

/** Translate only the retained Column grammar; no inferred columns or row keys. */
export function nativeTableTarget(node: RetainedJsxNode, bindings: readonly (NativeBindingIdentity & { authoredDomId?: string })[]): Extract<NativeBindingTarget, {kind:"table"}> | null {
  if (node.type !== "element" || node.tag !== "DataTable" || !node.children.some(child => child.type === "element" && child.tag === "Column")) return null;
  const proof = (node: RetainedJsxNode) => {
    const matches = bindings.filter(binding => binding.sourceNode === node.graphKey);
    if (matches.length !== 1) throw Error("Missing exact table identity");
    return matches[0]!;
  };
  const attrs = Object.fromEntries(node.attributes.map(attr => {
    if (!attr.value.static) throw Error("Dynamic table attribute requires separate admission");
    return [attr.name, attr.value.json];
  }));
  if (new Set(node.attributes.map(attr=>attr.name)).size !== node.attributes.length) throw Error("Duplicate table attribute");
  if (typeof attrs.id !== "string" || !attrs.id || typeof attrs.rowKey !== "string" || !attrs.rowKey || typeof attrs.data !== "string" || !/^\$[A-Za-z]\w*$/.test(attrs.data) || attrs.columns !== undefined) throw Error("Custom table requires its original owner, query and stable row key");
  if (attrs.transpose === true) throw Error("Transposed custom cells require a separately admitted scope");
  const columns: NativeTableColumn[] = [];
  const descendants = (node: RetainedJsxNode): RetainedJsxNode[] => [node, ...(node.type === "element" ? node.children.flatMap(descendants) : [])];
  for (const column of node.children) {
    if (column.type === "text" && !column.value.trim()) { proof(column); continue; }
    if (column.type !== "element" || column.tag !== "Column") throw Error("Only retained Column children are admitted");
    const values = Object.fromEntries(column.attributes.map(attr => {
      if (!attr.value.static) throw Error("Column attributes must be retained literals");
      return [attr.name, attr.value.json];
    }));
    if (new Set(column.attributes.map(attr=>attr.name)).size !== column.attributes.length) throw Error("Duplicate Column attribute");
    const hasContent = column.children.some(child => child.type !== "text" || !!child.value.trim());
    const { id, hasContent: _, ...spec } = admitDataColumn(values, hasContent);
    if (columns.some(column=>column.spec.col===spec.col)) throw Error("Duplicate Column name");
    const identity = proof(column), children = column.children.flatMap(descendants);
    if (children.some(child=>child.type==='element'&&['For','DataTable','Column'].includes(child.tag))) throw Error("Nested table cell scope requires separate admission");
    const childBindings = children.map(proof);
    columns.push({ sourceNode: column.graphKey, afId: identity.afId, ...(id ? {domId:id} : {}), spec,
      ...(hasContent ? {template:{templateId:`native-table-template-${identity.afId}`,templateIds:childBindings.map(child=>child.afId),domIds:childBindings.flatMap(child=>child.authoredDomId?[{domId:child.authoredDomId,templateAfId:child.afId}]:[])}} : {}) });
  }
  return {...proof(node),kind:'table',owner:attrs.id,rowKey:attrs.rowKey,columns};
}
