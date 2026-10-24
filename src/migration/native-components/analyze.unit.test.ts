import test from "node:test";
import assert from "node:assert/strict";
import { analyzeWithRetainedCompiler } from "./analyze.ts";
import { analyzeNativeRevision } from "./recover.ts";
import { nativeDigest } from "./selection.ts";
import type { NativeSelectedRevision } from "./contracts.ts";
import type {
  NativeTypedCompilerPort,
  RetainedCompilerSnapshot,
} from "./analyze-contracts.ts";
function fixture() {
  const document = {
    kind: "graph",
    schema: 3,
    claimedIds: { old: 1 },
    nodes: {
      $root: {
        parent: null,
        parts: ["", ""],
        children: ["element"],
        ast: null,
      },
      element: {
        parent: "$root",
        parts: ["<p>", "", "</p>"],
        children: ["text", "expr"],
        ast: {},
      },
      text: { parent: "element", parts: ["hello"], children: [], ast: {} },
      expr: { parent: "element", parts: ["{1}"], children: [], ast: {} },
    },
  };
  const revision: NativeSelectedRevision = {
    key: { sourceNamespace: "synthetic", sourceId: "p", version: 3 },
    original: { version: 3, document },
    documentSha256: nativeDigest(document),
    rowSha256: "test",
    matchingArchives: [],
  };
  const snapshot: RetainedCompilerSnapshot = {
    nodes: [
      {
        graphKey: "element",
        type: "element",
        tag: "p",
        isComponent: false,
        attributes: [],
        selfClosing: false,
        start: 0,
        end: 15,
        children: [
          { graphKey: "text", type: "text", value: "hello", start: 3, end: 8 },
          {
            graphKey: "expr",
            type: "expression",
            source: "1",
            value: { static: true, json: 1 },
            start: 8,
            end: 11,
          },
        ],
      },
    ],
    flow: { imports: [], values: [], queries: [], mutations: [] },
  };
  const port: NativeTypedCompilerPort = {
    fingerprint: async () => "pinned",
    extract: async () => snapshot,
  };
  return {
    revision,
    analysis: analyzeNativeRevision(revision),
    snapshot,
    port,
  };
}
test("retains real typed element/text/expression graph keys and source-version receipts", async () => {
  const f = fixture();
  const result = await analyzeWithRetainedCompiler(
    f.revision,
    f.analysis,
    "pinned",
    f.port,
  );
  assert.deepEqual(result.key, f.revision.key);
  assert.equal(result.nodes[0]?.graphKey, "element");
  assert.equal(result.sourceSpans.length, 4);
  assert.equal(result.compilerSourceSha256, "pinned");
  assert.equal(result.nodes[0]?.type, "element");
  assert.equal(result.sourceSha256, f.analysis.sourceSha256);
});
test("rejects stale revision, changed source/graph, compiler drift, missing/repeated/foreign typed mappings and functions", async () => {
  const f = fixture();
  await assert.rejects(
    analyzeWithRetainedCompiler(
      f.revision,
      { ...f.analysis, key: { ...f.analysis.key, version: 2 } },
      "pinned",
      f.port,
    ),
    /input/,
  );
  await assert.rejects(
    analyzeWithRetainedCompiler(
      f.revision,
      { ...f.analysis, source: "changed" },
      "pinned",
      f.port,
    ),
    /input/,
  );
  await assert.rejects(
    analyzeWithRetainedCompiler(f.revision, f.analysis, "different", f.port),
    /compiler/,
  );
  for (const mutate of [
    (s: any) => {
      s.nodes[0].children = [];
    },
    (s: any) => {
      s.nodes[0].graphKey = "foreign";
    },
    (s: any) => {
      s.nodes[0].children[1].graphKey = "text";
    },
    (s: any) => {
      s.flow.query = () => 1;
    },
  ]) {
    const s = structuredClone(f.snapshot);
    mutate(s);
    await assert.rejects(
      analyzeWithRetainedCompiler(f.revision, f.analysis, "pinned", {
        ...f.port,
        extract: async () => s,
      }),
    );
  }
  let checks = 0;
  await assert.rejects(
    analyzeWithRetainedCompiler(f.revision, f.analysis, "pinned", {
      ...f.port,
      fingerprint: async () => (++checks === 1 ? "pinned" : "changed"),
    }),
    /compiler/,
  );
});
