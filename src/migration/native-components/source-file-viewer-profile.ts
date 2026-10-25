import type {
  NativeTypedAnalysis,
  RetainedJsxNode,
} from "./analyze-contracts.ts";

export const NATIVE_SOURCE_FILE_VIEWER_SCRIPT_SHA256 =
  "dd6cc0177ead1cedc38446bcdb60f855f1769e30a57668bb277505e40fb09505";

export interface NativeSourceFileViewerProfile {
  profile: "native-query-observer";
  scriptSha256: string;
  queryNames: readonly ["file"];
  valueNames: readonly [];
  displaySelector: ".sv-code";
}

const flatten = (nodes: readonly RetainedJsxNode[]): RetainedJsxNode[] =>
  nodes.flatMap((node) => [
    node,
    ...(node.type === "element" ? flatten(node.children) : []),
  ]);

const staticString = (
  node: RetainedJsxNode,
  name: string,
): string | undefined => {
  if (node.type !== "element") return undefined;
  const matches = node.attributes.filter(
    (attribute) => attribute.name === name,
  );
  if (matches.length !== 1) return undefined;
  const value = matches[0]!.value;
  return value.static && typeof value.json === "string"
    ? value.json
    : undefined;
};

/**
 * Select the exact read-only file-viewer author profile after the common
 * author-program adapter has verified the script body hash and node receipt.
 * This function checks the page-side bindings that its observer needs.
 */
export function admitNativeSourceFileViewerProfile(
  analysis: NativeTypedAnalysis,
  scriptNode: RetainedJsxNode,
  verifiedScriptSha256: string,
): NativeSourceFileViewerProfile {
  if (
    verifiedScriptSha256 !== NATIVE_SOURCE_FILE_VIEWER_SCRIPT_SHA256 ||
    scriptNode.type !== "element" ||
    scriptNode.tag !== "script" ||
    scriptNode.attributes.length !== 0
  ) {
    throw new Error(
      "Source file-viewer script is outside the reviewed profile",
    );
  }
  const nodes = flatten(analysis.nodes);
  if (
    nodes.filter((node) => node.graphKey === scriptNode.graphKey).length !==
      1 ||
    nodes.filter((node) => node.type === "element" && node.tag === "script")
      .length !== 1
  ) {
    throw new Error("Source file-viewer script identity is ambiguous");
  }

  const pathValues = analysis.flow.values.filter(
    (value) => value.name === "path" && value.type === "string",
  );
  const pathQueries = analysis.flow.queries.filter((query) =>
    ["paths", "file"].includes(query.name),
  );
  const selects = nodes.filter(
    (node) =>
      node.type === "element" &&
      node.tag === "Select" &&
      staticString(node, "value") === "$path" &&
      staticString(node, "options") === "$paths",
  );
  const viewers = nodes.filter((node) => {
    if (node.type !== "element" || node.tag !== "pre") return false;
    const className =
      staticString(node, "className") ?? staticString(node, "class");
    return className?.split(/\s+/).includes("sv-code") === true;
  });

  if (
    pathValues.length !== 1 ||
    analysis.flow.values.length !== 1 ||
    pathQueries.length !== 2 ||
    analysis.flow.queries.length !== 2 ||
    analysis.flow.imports.length !== 1 ||
    new Set(pathQueries.map((query) => query.name)).size !== 2 ||
    selects.length !== 1 ||
    viewers.length !== 1 ||
    analysis.flow.mutations.length !== 0
  ) {
    throw new Error(
      "Source file-viewer bindings do not match the reviewed profile",
    );
  }
  return {
    profile: "native-query-observer",
    scriptSha256: verifiedScriptSha256,
    queryNames: ["file"],
    valueNames: [],
    displaySelector: ".sv-code",
  };
}
