import assert from "node:assert/strict";
import test from "node:test";
import type {
  NativeTypedAnalysis,
  NativeJson,
  RetainedJsxNode,
} from "./analyze-contracts.ts";
import {
  admitNativeSourceFileViewerProfile,
  NATIVE_SOURCE_FILE_VIEWER_SCRIPT_SHA256,
} from "./source-file-viewer-profile.ts";

let next = 0;
const text = (value: string): RetainedJsxNode => ({
  type: "text",
  graphKey: `text-${next++}`,
  start: 0,
  end: value.length,
  value,
});
const element = (
  tag: string,
  attributes: Record<string, NativeJson> = {},
  children: RetainedJsxNode[] = [],
): RetainedJsxNode => ({
  type: "element",
  graphKey: `node-${next++}`,
  start: 0,
  end: 1,
  tag,
  isComponent: /^[A-Z]/.test(tag),
  attributes: Object.entries(attributes).map(([name, json]) => ({
    name,
    start: 0,
    end: 1,
    value: { static: true, json },
  })),
  children,
  selfClosing: !children.length,
});
function fixture(): {
  analysis: NativeTypedAnalysis;
  script: RetainedJsxNode;
} {
  next = 0;
  const script = element("script", {}, [
    text("synthetic private body omitted"),
  ]);
  const helmet = element("Helmet", {}, [script]);
  const body = element("div", {}, [
    element("Select", { value: "$path", options: "$paths" }),
    element("pre", { className: "sv-code mt-3" }),
  ]);
  return {
    script,
    analysis: {
      key: { sourceNamespace: "fixture", sourceId: "fixture-page", version: 1 },
      documentSha256: "a".repeat(64),
      sourceSha256: "b".repeat(64),
      analysisSha256: "c".repeat(64),
      compilerSourceSha256: "d".repeat(64),
      nodes: [helmet, body],
      sourceSpans: [],
      flow: {
        imports: [{ name: "src", start: 0, end: 1 }],
        values: [{ name: "path", type: "string", start: 0, end: 1 }],
        queries: [
          { name: "paths", start: 0, end: 1 },
          { name: "file", start: 1, end: 2 },
        ],
        mutations: [],
      },
    },
  };
}

test("admits only the exact read-only file-viewer script and page structure", () => {
  const { analysis, script } = fixture();
  assert.deepEqual(
    admitNativeSourceFileViewerProfile(
      analysis,
      script,
      NATIVE_SOURCE_FILE_VIEWER_SCRIPT_SHA256,
    ),
    {
      profile: "native-query-observer",
      scriptSha256: NATIVE_SOURCE_FILE_VIEWER_SCRIPT_SHA256,
      queryNames: ["file"],
      valueNames: [],
      displaySelector: ".sv-code",
    },
  );
});

test("rejects a different script body before selecting an observer profile", () => {
  const { analysis, script } = fixture();
  assert.throws(
    () => admitNativeSourceFileViewerProfile(analysis, script, "0".repeat(64)),
    /outside the reviewed profile/,
  );
});

test("requires the bound path control, both read queries and the code display", () => {
  const wrongControl = fixture();
  if (wrongControl.analysis.nodes[1]?.type !== "element")
    throw Error("fixture");
  wrongControl.analysis.nodes[1].children[0] = element("Select", {
    value: "$other",
    options: "$paths",
  });
  assert.throws(
    () =>
      admitNativeSourceFileViewerProfile(
        wrongControl.analysis,
        wrongControl.script,
        NATIVE_SOURCE_FILE_VIEWER_SCRIPT_SHA256,
      ),
    /bindings do not match/,
  );

  const missingQuery = fixture();
  missingQuery.analysis.flow.queries = [{ name: "paths", start: 0, end: 1 }];
  assert.throws(
    () =>
      admitNativeSourceFileViewerProfile(
        missingQuery.analysis,
        missingQuery.script,
        NATIVE_SOURCE_FILE_VIEWER_SCRIPT_SHA256,
      ),
    /bindings do not match/,
  );
});

test("rejects ambiguous script and mutation-bearing pages", () => {
  const duplicateScript = fixture();
  duplicateScript.analysis.nodes.push(element("script", {}, [text("second")]));
  assert.throws(
    () =>
      admitNativeSourceFileViewerProfile(
        duplicateScript.analysis,
        duplicateScript.script,
        NATIVE_SOURCE_FILE_VIEWER_SCRIPT_SHA256,
      ),
    /identity is ambiguous/,
  );

  const mutations = fixture();
  mutations.analysis.flow.mutations.push({ name: "write", start: 0, end: 1 });
  assert.throws(
    () =>
      admitNativeSourceFileViewerProfile(
        mutations.analysis,
        mutations.script,
        NATIVE_SOURCE_FILE_VIEWER_SCRIPT_SHA256,
      ),
    /bindings do not match/,
  );
});
