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

/** Missing root children have exact retained sibling positions; nested losses remain refused. */
export function recoverPartialLegacyDocument(
  document: unknown,
):
  | import("./document-recovery-contracts.ts").LegacyPartialDocumentRecovery
  | null {
  try {
    if (
      !document ||
      typeof document !== "object" ||
      Buffer.byteLength(JSON.stringify(document)) > MAX_COMPILED_SOURCE_BYTES
    )
      return null;
    const graph = structuredClone(document) as {
      schema?: unknown;
      kind?: unknown;
      nodes?: Record<string, { parts?: unknown; children?: unknown }>;
    };
    if (
      graph.schema !== 3 ||
      graph.kind !== "graph" ||
      !graph.nodes ||
      Array.isArray(graph.nodes)
    )
      return null;
    const root = graph.nodes.$root;
    if (
      !root ||
      !Array.isArray(root.parts) ||
      !root.parts.every((p) => p === "") ||
      !Array.isArray(root.children) ||
      root.parts.length !== root.children.length + 1
    )
      return null;
    const missing = new Set<string>();
    for (const [key, node] of Object.entries(graph.nodes)) {
      if (
        !node ||
        !Array.isArray(node.children) ||
        !node.children.every((c) => typeof c === "string")
      )
        return null;
      for (const child of node.children)
        if (!Object.hasOwn(graph.nodes, child)) {
          if (key !== "$root") return null;
          missing.add(child);
        }
    }
    if (!missing.size) return null;
    for (const key of missing)
      Object.defineProperty(graph.nodes, key, {
        value: {
          parts: ['<p role="note">Original saved content unavailable</p>'],
          children: [],
        },
        enumerable: true,
      });
    const source = legacyDocumentSource(graph);
    return Buffer.byteLength(source) <= MAX_COMPILED_SOURCE_BYTES
      ? { source, missingNodes: missing.size }
      : null;
  } catch {
    return null;
  }
}

export const recoverRetiredSourceWrapper: import("./document-recovery-contracts.ts").RecoverRetiredSourceWrapper =
  (document) => {
    if (!document || typeof document !== "object" || Array.isArray(document))
      return null;
    const keys = Reflect.ownKeys(document);
    if (
      keys.length !== 3 ||
      !keys.every(
        (k) =>
          typeof k === "string" && ["kind", "schema", "source"].includes(k),
      )
    )
      return null;
    const value = document as {
      kind?: unknown;
      schema?: unknown;
      source?: unknown;
    };
    if (
      value.kind !== "source" ||
      value.schema !== 1 ||
      typeof value.source !== "string" ||
      !value.source.trim() ||
      Buffer.byteLength(value.source) > MAX_COMPILED_SOURCE_BYTES
    )
      return null;
    return { source: value.source };
  };
