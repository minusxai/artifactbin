import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCodeQLUpload,
  exportedCodeQLRules,
} from "../scripts/ci/codeql-upload.ts";
import type {
  CodeQLStoredAnalysis,
  CodeQLUploadExpectation,
} from "../scripts/ci/contracts.ts";
const expected: CodeQLUploadExpectation = {
  sarifId: "upload",
  sha: "checked-sha",
  ref: "refs/heads/main",
  category: "security-lane",
  rules: 2,
};
const complete = { processing_status: "complete", errors: null };
const analysis: CodeQLStoredAnalysis = {
  sarif_id: expected.sarifId,
  commit_sha: expected.sha,
  ref: expected.ref,
  category: expected.category,
  rules_count: 2,
  error: "",
  tool: { name: "CodeQL" },
};
test("complete delivery requires the exact checked analysis and all exported rules", () => {
  assertCodeQLUpload(complete, [analysis], expected);
  for (const patch of [
    { error: "Unknown Error", rules_count: 0 },
    { error: "Unknown Error" },
    { rules_count: 0 },
    { rules_count: 1 },
    { rules_count: 3 },
    { sarif_id: "previous-upload" },
    { commit_sha: "previous-sha" },
    { ref: "refs/heads/other" },
    { category: "other-lane" },
    { tool: { name: "other" } },
  ])
    assert.throws(() =>
      assertCodeQLUpload(complete, [{ ...analysis, ...patch }], expected),
    );
});
test("missing, malformed, pending and failed server analyses never pass", () => {
  for (const status of [
    null,
    {},
    { processing_status: "pending" },
    { processing_status: "failed" },
    { ...complete, errors: ["provider error"] },
  ])
    assert.throws(() => assertCodeQLUpload(status, [analysis], expected));
  for (const analyses of [
    null,
    {},
    [],
    [null],
    [{ ...analysis, error: null }],
    [analysis, analysis],
  ])
    assert.throws(() => assertCodeQLUpload(complete, analyses, expected));
});

test("exported rule counts include combined language extensions and allow zero findings", () => {
  const sarif = {
    runs: [
      {
        tool: {
          driver: { rules: [] },
          extensions: [
            { rules: [{ id: "py/a" }] },
            { rules: [{ id: "actions/a" }] },
          ],
        },
        results: [],
      },
    ],
  };
  assert.equal(exportedCodeQLRules(sarif), 2);
  assertCodeQLUpload(complete, [{ ...analysis, results_count: 0 }], expected);
  for (const value of [
    null,
    {},
    { runs: [] },
    { runs: [{ tool: { driver: { rules: [] } } }] },
  ])
    assert.throws(() => exportedCodeQLRules(value));
});

test("duplicate partial analyses cannot masquerade as a complete upload", () => {
  assert.throws(() =>
    assertCodeQLUpload(complete, [analysis, analysis], {
      ...expected,
      rules: 4,
    }),
  );
});
