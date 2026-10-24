import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBatchWithRetainedCompiler } from "./analyze.ts";
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
    claimedIds: {},
    nodes: {
      $root: { parent: null, parts: ["", ""], children: ["text"], ast: null },
      text: { parent: "$root", parts: ["kept"], children: [], ast: {} },
    },
  };
  const revision: NativeSelectedRevision = {
    key: { sourceNamespace: "synthetic", sourceId: "page", version: 1 },
    documentSha256: nativeDigest(document),
    rowSha256: "test",
    original: { version: 1, document },
    matchingArchives: [],
  };
  const input = { revision, analysis: analyzeNativeRevision(revision) };
  let checks = 0,
    extractions = 0;
  const snapshot: RetainedCompilerSnapshot = {
    nodes: [
      { graphKey: "text", type: "text", value: "kept", start: 0, end: 4 },
    ],
    flow: { imports: [], values: [], queries: [], mutations: [] },
  };
  const port: NativeTypedCompilerPort = {
    fingerprint: async () => {
      checks++;
      return "pin";
    },
    extract: async () => {
      extractions++;
      return snapshot;
    },
  };
  return { input, port, checks: () => checks, extractions: () => extractions };
}
test("checks complete compiler source once before and after bounded work, preserving every revision result", async () => {
  const f = fixture();
  const results = await analyzeBatchWithRetainedCompiler(
    [f.input, f.input],
    "pin",
    f.port,
  );
  assert.equal(results.length, 2);
  assert.equal(f.checks(), 2);
  assert.equal(f.extractions(), 2);
  assert.deepEqual(results[0], results[1]);
});
test("discards all outputs on end-of-batch drift and does not cache source claims between calls", async () => {
  const f = fixture();
  let pin = "pin";
  const port = {
    ...f.port,
    fingerprint: async () => pin,
    extract: async (d: unknown) => {
      const snapshot = await f.port.extract(d);
      pin = "changed";
      return snapshot;
    },
  };
  await assert.rejects(
    analyzeBatchWithRetainedCompiler([f.input], "pin", port),
    /compiler_changed/,
  );
  await assert.rejects(
    analyzeBatchWithRetainedCompiler([f.input], "pin", port),
    /compiler_changed/,
  );
  assert.equal(f.extractions(), 1);
});
test("refuses empty or oversized batches before source reads and rejects the whole batch for malformed input", async () => {
  const f = fixture();
  await assert.rejects(
    analyzeBatchWithRetainedCompiler([], "pin", f.port),
    /batch_size/,
  );
  await assert.rejects(
    analyzeBatchWithRetainedCompiler(
      Array.from({ length: 65 }, () => f.input),
      "pin",
      f.port,
    ),
    /batch_size/,
  );
  assert.equal(f.checks(), 0);
  await assert.rejects(
    analyzeBatchWithRetainedCompiler(
      [
        f.input,
        { ...f.input, analysis: { ...f.input.analysis, source: "changed" } },
      ],
      "pin",
      f.port,
    ),
    /input_mismatch/,
  );
});
