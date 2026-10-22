import { legacyDocumentSource } from "./index.ts";
import { MAX_COMPILED_SOURCE_BYTES } from "./compiled/contracts.ts";
import type { RecoverLegacyDocumentSource } from "./document-recovery-contracts.ts";
export const recoverLegacyDocumentSource: RecoverLegacyDocumentSource = (
  document,
  oracle,
) => {
  try {
    if (
      !document ||
      typeof document !== "object" ||
      Buffer.byteLength(JSON.stringify(document)) > MAX_COMPILED_SOURCE_BYTES
    )
      return null;
    const graph = structuredClone(document) as {
      kind?: unknown;
      schema?: unknown;
      nodes?: Record<
        string,
        { parts?: unknown; children?: unknown; ast?: unknown }
      >;
    };
    if (
      graph.kind !== "graph" ||
      graph.schema !== 3 ||
      !graph.nodes ||
      Array.isArray(graph.nodes)
    )
      return null;
    let repairedNodes = 0;
    for (const node of Object.values(graph.nodes)) {
      if (
        !node ||
        !Array.isArray(node.parts) ||
        !node.parts.every((p) => typeof p === "string") ||
        !Array.isArray(node.children) ||
        !node.children.every((c) => typeof c === "string")
      )
        return null;
      if (node.parts.length === node.children.length + 1) continue;
      if (
        node.parts.length !== 2 ||
        node.children.length < 2 ||
        !node.ast ||
        oracle.ownSource(node.ast) !== node.parts.join("")
      )
        return null;
      node.parts = [
        node.parts[0],
        ...Array(node.children.length - 1).fill(""),
        node.parts[1],
      ];
      repairedNodes++;
    }
    if (!repairedNodes) return null;
    const source = legacyDocumentSource(graph);
    if (
      Buffer.byteLength(source) > MAX_COMPILED_SOURCE_BYTES ||
      oracle.canonicalSource(source) !== oracle.canonicalDocument(document)
    )
      return null;
    return { source, repairedNodes };
  } catch {
    return null;
  }
};
