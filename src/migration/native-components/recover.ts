import { legacyDocumentSource } from "../conversion/index.ts";
import { recoverLegacyDocumentSource } from "../conversion/document-recovery.ts";
import { nativeDigest } from "./selection.ts";
import { createHash } from "node:crypto";
import type {
  AnalyzeNativeRevision,
  NativeGraphIdentity,
} from "./contracts.ts";
interface GraphNode {
  parts: string[];
  children: string[];
  parent: string | null;
  ast: unknown;
  [field: string]: unknown;
}
/** Lossless extraction and identity analysis only; never produces HTML or executes source. */
export const analyzeNativeRevision: AnalyzeNativeRevision = (
  revision,
  options = {},
) => {
  const original = revision.original.document;
  if (nativeDigest(original) !== revision.documentSha256)
    throw Error("native_document_digest");
  const graph = structuredClone(original) as {
    kind?: unknown;
    schema?: unknown;
    nodes: Record<string, GraphNode>;
    claimedIds?: Record<string, unknown>;
  };
  let source: string,
    repairedNodes = 0;
  try {
    source = legacyDocumentSource(graph);
  } catch {
    const recovered = options.oracle
      ? recoverLegacyDocumentSource(original, options.oracle)
      : null;
    if (!recovered) throw Error("native_graph_recovery_refused");
    repairedNodes = recovered.repairedNodes;
    // Apply only the precise separator repair proved by the retained oracle.
    for (const node of Object.values(graph.nodes))
      if (node.parts.length !== node.children.length + 1)
        node.parts = [
          node.parts[0]!,
          ...Array(node.children.length - 1).fill(""),
          node.parts[1]!,
        ];
    source = legacyDocumentSource(graph);
    if (source !== recovered.source)
      throw Error("native_graph_recovery_mismatch");
  }
  if (
    !graph.claimedIds ||
    typeof graph.claimedIds !== "object" ||
    Array.isArray(graph.claimedIds)
  )
    throw Error("native_graph_claims");
  const visited = new Set<string>();
  const identities: NativeGraphIdentity[] = [];
  const components: Record<string, number> = Object.create(null);
  const inspect = (ast: unknown): void => {
    if (Array.isArray(ast)) {
      ast.forEach(inspect);
      return;
    }
    if (!ast || typeof ast !== "object") return;
    const value = ast as Record<string, unknown>;
    if (
      value.type === "element" &&
      value.isComponent === true &&
      typeof value.tag === "string"
    )
      components[value.tag] = (components[value.tag] ?? 0) + 1;
    Object.values(value).forEach(inspect);
  };
  const visit = (key: string, parent: string | null, start: number): number => {
    if (visited.has(key)) throw Error("native_graph_repeated");
    visited.add(key);
    const node = graph.nodes[key];
    if (!node || node.parent !== parent) throw Error("native_graph_parent");
    const originalNode = (original as { nodes: Record<string, GraphNode> })
      .nodes[key]!;
    const identity: NativeGraphIdentity = {
      sourceNode: key,
      parent,
      children: [...node.children],
      astSha256: nativeDigest(originalNode.ast),
      nodeSha256: nativeDigest(originalNode),
      sourceStart: start,
      sourceEnd: start,
    };
    identities.push(identity);
    inspect(originalNode.ast);
    let position = start + node.parts[0]!.length;
    for (const [index, child] of node.children.entries())
      position = visit(child, key, position) + node.parts[index + 1]!.length;
    identity.sourceEnd = position;
    return position;
  };
  if (
    visit("$root", null, 0) !== source.length ||
    visited.size !== Object.keys(graph.nodes).length
  )
    throw Error("native_graph_disconnected");
  return {
    key: { ...revision.key },
    documentSha256: revision.documentSha256,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    source,
    identities,
    claimedIds: structuredClone(graph.claimedIds),
    components: { ...components },
    recovery: {
      kind: repairedNodes ? "proved-empty-separators" : "exact",
      repairedNodes,
    },
  };
};
