import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { externalCompile } from "../conversion/compiled/index.ts";
import { analyzeNativeRevision } from "./recover.ts";
import { nativeDigest } from "./selection.ts";
import type {
  NativeGraphAnalysis,
  NativeSelectedRevision,
} from "./contracts.ts";
import type {
  AnalyzeNativeTypedRevision,
  AnalyzeNativeTypedBatch,
  NativeTypedBatchInput,
  NativeTypedAnalysis,
  NativeTypedCompilerPort,
  RetainedCompilerSnapshot,
  RetainedJsxNode,
} from "./analyze-contracts.ts";
/** Conservative pin includes complete retained library/contracts/util source trees and dependency/alias manifests. */
export async function retainedCompilerFingerprint(
  root: string,
): Promise<string> {
  const files: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const next = relative + "/" + entry.name;
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile() && /\.(?:ts|tsx|js|json|txt)$/.test(entry.name))
        files.push(next);
    }
  };
  for (const directory of [
    "services/app/lib",
    "services/contracts/src",
    "services/utils",
  ])
    await walk(directory);
  files.push("package-lock.json", "tsconfig.json");
  const hashes = [];
  for (const file of files.sort())
    hashes.push([
      file,
      createHash("sha256")
        .update(await readFile(path.join(root, file)))
        .digest("hex"),
    ]);
  return nativeDigest(hashes);
}
function jsonOnly(value: unknown, seen = new Set<object>()): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return;
  if (!value || typeof value !== "object" || seen.has(value))
    throw Error("native_typed_non_json");
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  )
    throw Error("native_typed_non_json");
  seen.add(value);
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!Object.hasOwn(descriptor, "value"))
      throw Error("native_typed_non_json");
    if (descriptor.value !== undefined) jsonOnly(descriptor.value, seen);
    else throw Error("native_typed_non_json");
  }
  seen.delete(value);
}
/** Validation is independent of the compiler port; snapshots retain actual decoder data without reinterpreting expressions. */
export async function analyzeWithRetainedCompiler(
  revision: NativeSelectedRevision,
  analysis: NativeGraphAnalysis,
  pin: string,
  port: NativeTypedCompilerPort,
): Promise<NativeTypedAnalysis> {
  jsonOnly(revision.original.document);
  const recovered = analyzeNativeRevision(revision);
  if (nativeDigest(recovered) !== nativeDigest(analysis))
    throw Error("native_typed_input_mismatch");
  if ((await port.fingerprint()) !== pin)
    throw Error("native_typed_compiler_changed");
  const snapshot = await port.extract(revision.original.document);
  jsonOnly(snapshot);
  if ((await port.fingerprint()) !== pin)
    throw Error("native_typed_compiler_changed");
  if (
    !snapshot ||
    !Array.isArray(snapshot.nodes) ||
    !snapshot.flow ||
    !["imports", "values", "queries", "mutations"].every((key) =>
      Array.isArray(snapshot.flow[key as keyof typeof snapshot.flow]),
    )
  )
    throw Error("native_typed_shape");
  const expected = new Map(
    analysis.identities
      .filter((n) => n.sourceNode !== "$root")
      .map((n) => [n.sourceNode, n]),
  );
  const seen = new Set<string>();
  const visit = (node: RetainedJsxNode, parent: string): void => {
    const original = expected.get(node.graphKey);
    if (!original || original.parent !== parent || seen.has(node.graphKey))
      throw Error("native_typed_graph_mapping");
    seen.add(node.graphKey);
    if (!["element", "text", "expression"].includes(node.type))
      throw Error("native_typed_node_type");
    if (node.type === "element") {
      if (
        typeof node.tag !== "string" ||
        !Array.isArray(node.attributes) ||
        !Array.isArray(node.children) ||
        nativeDigest(node.children.map((n) => n.graphKey)) !==
          nativeDigest(original.children)
      )
        throw Error("native_typed_element");
      node.children.forEach((child) => visit(child, node.graphKey));
    } else if (
      original.children.length ||
      (node.type === "text" && typeof node.value !== "string") ||
      (node.type === "expression" &&
        (!node.value || typeof node.source !== "string"))
    )
      throw Error("native_typed_leaf");
  };
  snapshot.nodes.forEach((node) => visit(node, "$root"));
  const root = analysis.identities.find((n) => n.sourceNode === "$root");
  if (
    seen.size !== expected.size ||
    nativeDigest(snapshot.nodes.map((n) => n.graphKey)) !==
      nativeDigest(root?.children)
  )
    throw Error("native_typed_graph_mapping");
  return {
    key: { ...revision.key },
    documentSha256: analysis.documentSha256,
    sourceSha256: analysis.sourceSha256,
    analysisSha256: nativeDigest(analysis),
    compilerSourceSha256: pin,
    ...structuredClone(snapshot),
    sourceSpans: analysis.identities.map(
      ({ sourceNode, sourceStart, sourceEnd }) => ({
        sourceNode,
        sourceStart,
        sourceEnd,
      }),
    ),
  };
}
export const analyzeNativeTypedRevision: AnalyzeNativeTypedRevision = (
  revision,
  analysis,
  options,
) =>
  analyzeWithRetainedCompiler(
    revision,
    analysis,
    options.compilerSourceSha256,
    {
      fingerprint: () => retainedCompilerFingerprint(options.legacyRoot),
      extract: (document) =>
        externalCompile<RetainedCompilerSnapshot, { document: unknown }>(
          { document },
          { legacyRoot: options.legacyRoot },
          "../../native-components/analyze-runner.mts",
        ),
    },
  );

/** Compiler source is verified at both batch boundaries, never cached across calls.
 * Outputs remain private until the closing check passes; any failure rejects the whole batch.
 * This is a bracketed verification session, not an assertion that a mutable tree is immutable.
 */
export async function analyzeBatchWithRetainedCompiler(
  inputs: readonly NativeTypedBatchInput[],
  pin: string,
  port: NativeTypedCompilerPort,
): Promise<NativeTypedAnalysis[]> {
  if (!inputs.length || inputs.length > 64)
    throw Error("native_typed_batch_size");
  if ((await port.fingerprint()) !== pin)
    throw Error("native_typed_compiler_changed");
  const results: NativeTypedAnalysis[] = [];
  for (const { revision, analysis } of inputs) {
    results.push(
      await analyzeWithRetainedCompiler(revision, analysis, pin, {
        fingerprint: async () => pin,
        extract: (document) => port.extract(document),
      }),
    );
  }
  if ((await port.fingerprint()) !== pin)
    throw Error("native_typed_compiler_changed");
  return results;
}
export const analyzeNativeTypedBatch: AnalyzeNativeTypedBatch = (
  inputs,
  options,
) =>
  analyzeBatchWithRetainedCompiler(inputs, options.compilerSourceSha256, {
    fingerprint: () => retainedCompilerFingerprint(options.legacyRoot),
    extract: (document) =>
      externalCompile<RetainedCompilerSnapshot, { document: unknown }>(
        { document },
        { legacyRoot: options.legacyRoot },
        "../../native-components/analyze-runner.mts",
      ),
  });
