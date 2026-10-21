import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import type { DeploymentGateContext } from "../scripts/ci/contracts.ts";

const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
const deploy = workflow.split(/^  deploy:\s*$/m)[1];
assert.ok(deploy, "deployment job exists");
const condition = deploy.match(/^    if: (.+)$/m)?.[1];
assert.ok(condition, "deployment has an explicit gate");
function eligible(context: DeploymentGateContext): boolean {
  return Boolean(runInNewContext(condition!, context));
}
function context(): DeploymentGateContext {
  return {
    github: { ref: "refs/heads/main", event_name: "push" },
    inputs: { "codeql-proof-only": false },
    needs: {
      fast: { result: "success" },
      security: { result: "success" },
      node: { result: "success" },

    },
  };
}

test("deployment waits directly for every test and security job", () => {
  assert.match(deploy, /^    needs: \[fast, node, security\]$/m);
  assert.doesNotMatch(workflow, /^  check:\s*$/m);
  for (const job of ["fast", "security", "node"] as const) {
    for (const result of ["failure", "skipped", "cancelled"] as const) {
      const input = context();
      input.needs[job].result = result;
      assert.equal(eligible(input), false, `${job}: ${result}`);
    }
  }
  for (const job of ["fast", "security", "node"] as const) {
    const input = context();
    delete (input.needs as Partial<DeploymentGateContext["needs"]>)[job];
    assert.throws(() => eligible(input), `${job}: missing evidence cannot authorize deployment`);
  }
  assert.equal(eligible(context()), true);
});

test("only successful main push or manual runs deploy their exact tested SHA", () => {
  const input = context();
  input.github.event_name = "workflow_dispatch";
  assert.equal(eligible(input), true);
  input.github.ref = "refs/heads/feature";
  assert.equal(eligible(input), false);
  input.github.ref = "refs/heads/main";
  input.github.event_name = "pull_request";
  assert.equal(eligible(input), false);
  assert.match(deploy, /git archive --format=tar\.gz "\$GITHUB_SHA"/);
  assert.match(deploy, /"deploy \$GITHUB_SHA"/);
});

test("manual proof cannot deploy and normal runs retain SARIF uploads", () => {
  const input = context();
  input.github.event_name = "workflow_dispatch";
  input.inputs["codeql-proof-only"] = true;
  assert.equal(eligible(input), false);
  const upload = workflow.match(/upload: \$\{\{ (.+) \}\}/)?.[1];
  assert.ok(upload);
  assert.equal(runInNewContext(upload, input), "never");
  for (const event of ["push", "pull_request"]) {
    input.github.event_name = event;
    assert.equal(runInNewContext(upload, input), "always");
  }
  input.github.event_name = "workflow_dispatch";
  input.inputs["codeql-proof-only"] = false;
  assert.equal(runInNewContext(upload, input), "always");
  assert.match(workflow, /upload-database: false/);
  assert.match(workflow, /wait-for-processing: false/);
  assert.match(workflow, /run: npm run \$\{\{ matrix.check \}\}/);
});

test("only manual proof retains private security evidence", () => {
  const condition = workflow.match(
    /name: Preserve proof security results\n        if: (.+)/,
  )?.[1];
  assert.ok(condition);
  const input = context();
  input.inputs["codeql-proof-only"] = true;
  assert.equal(Boolean(runInNewContext(condition, input)), false);
  input.github.event_name = "workflow_dispatch";
  assert.equal(Boolean(runInNewContext(condition, input)), true);
  input.inputs["codeql-proof-only"] = false;
  assert.equal(Boolean(runInNewContext(condition, input)), false);
  assert.match(
    workflow,
    /path: results\/\*\.sarif\n          if-no-files-found: error\n          retention-days: 7/,
  );
});

test("one required security lane proves the complete query partition", () => {
  const condition = workflow.match(
    /name: Prove complete installed JavaScript query coverage\n        if: (.+)/,
  )?.[1];
  assert.ok(condition);
  const security = workflow
    .split(/^  security:\s*$/m)[1]!
    .split(/^  deploy:/m)[0]!;
  const lanes = [
    ...security.matchAll(
      /- language: ([^\n]+)\n            partition: ([^\n]+)/g,
    ),
  ].map((match) => ({ language: match[1], partition: match[2] }));
  assert.equal(
    lanes.length,
    4,
    "security retains four partitions alongside the fast gate and 16 test jobs",
  );
  assert.deepEqual(
    lanes
      .filter((lane) => lane.language === "javascript-typescript")
      .map((lane) => lane.partition)
      .sort(),
    ["a", "b", "c"],
  );
  assert.match(workflow, /language: python,actions/);
  assert.deepEqual(
    lanes
      .filter((matrix) => runInNewContext(condition, { matrix }))
      .map((lane) => lane.language),
    ["python,actions"],
    "the shorter combined lane proves the full JavaScript union without delaying a JavaScript analysis",
  );
  const input = context();
  input.needs.security.result = "failure";
  assert.equal(eligible(input), false);
});

test("security helpers use cached Node 22 while product runtimes keep their exact pin", () => {
  const security = workflow
    .split(/^  security:\s*$/m)[1]!
    .split(/^  deploy:/m)[0]!;
  assert.match(security, /node-version: "22"\n          check-latest: false/);
  const prepare = readFileSync(".github/actions/prepare/action.yml", "utf8");
  assert.match(prepare, /node-version: 22\.22\.3/);
});

test("normal security uploads require stored analysis verification while offline proof skips it", () => {
  const condition = workflow.match(
    /name: Verify stored security analysis\n        if: (.+)/,
  )?.[1];
  assert.ok(condition);
  const input = context();
  for (const event of ["push", "pull_request", "workflow_dispatch"]) {
    input.github.event_name = event;
    input.inputs["codeql-proof-only"] = false;
    assert.equal(Boolean(runInNewContext(condition, input)), true);
  }
  input.inputs["codeql-proof-only"] = true;
  assert.equal(Boolean(runInNewContext(condition, input)), false);
  input.github.event_name = "pull_request";
  assert.equal(Boolean(runInNewContext(condition, input)), true);
  assert.match(
    workflow,
    /uses: github\/codeql-action\/analyze@v4\n        id: analysis/,
  );
  assert.match(
    workflow,
    /CODEQL_SARIF_ID: \$\{\{ steps.analysis.outputs.sarif-id \}\}/,
  );
  assert.match(
    workflow,
    /CODEQL_SARIF_OUTPUT: \$\{\{ steps.analysis.outputs.sarif-output \}\}/,
  );
  assert.match(workflow, /wait-for-processing: false/);
});


test("pull requests run only the dependency-light fast gate while main retains full coverage", () => {
  const fast = workflow.split(/^  fast:\s*$/m)[1]?.split(/^  node:/m)[0];
  assert.ok(fast);
  assert.match(fast, /cache: npm/);
  assert.match(fast, /run: npm ci/);
  const checks = fast.match(/check: \[([^\]]+)\]/)?.[1]?.split(",").map(check => check.trim());
  assert.deepEqual(checks, ["validate", "test"]);
  assert.match(fast, /fail-fast: false/);
  assert.match(fast, /run: npm run \$\{\{ matrix.check \}\}/);
  const metadataCondition = fast.match(/name: Restore incremental type-check metadata\n        if: (.+)/)?.[1];
  assert.ok(metadataCondition);
  for (const check of checks) assert.equal(Boolean(runInNewContext(metadataCondition, { matrix: { check } })), check === "validate");
  assert.doesNotMatch(fast, /prepare|docker|playwright|build/);
  for (const job of ["node", "security"]) {
    const condition = workflow.split(new RegExp(`^  ${job}:\\s*$`, "m"))[1]?.match(/^    if: (.+)$/m)?.[1];
    assert.ok(condition, job);
    for (const event of ["pull_request", "push", "workflow_dispatch"]) {
      const input = context(); input.github.event_name = event;
      assert.equal(Boolean(runInNewContext(condition, input)), event !== "pull_request", `${job}: ${event}`);
    }
  }
});

test("superseded pull requests cancel while main and manual runs finish their evidence", () => {
  assert.match(workflow, /group: pagegi-\$\{\{ github.ref \}\}/);
  const condition = workflow.match(/cancel-in-progress: \$\{\{ (.+) \}\}/)?.[1];
  assert.ok(condition);
  for (const event of ["pull_request", "push", "workflow_dispatch"]) {
    const input = context(); input.github.event_name = event;
    assert.equal(Boolean(runInNewContext(condition, input)), event === "pull_request");
  }
});
