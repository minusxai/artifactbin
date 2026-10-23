import test from "node:test";
import assert from "node:assert/strict";
import { observeBackendCreate } from "../src/backend/create-diagnostics.ts";
test("create diagnostics preserve success without logging", async () => {
  assert.equal(
    await observeBackendCreate(
      "compile",
      async () => 42,
      () => assert.fail(),
    ),
    42,
  );
});
test("create failures log only authoritative allowlisted metadata and preserve rejection", async () => {
  for (const [props, metadata] of [
    [{ code: 1 }, { category: "exit", exitCode: 1 }],
    [{ code: "ETIMEDOUT" }, { category: "timeout" }],
    [
      { code: "ABORT_ERR", signal: "SIGTERM" },
      { category: "aborted", signal: "SIGTERM" },
    ],
    [
      { killed: true, signal: "SIGTERM" },
      { category: "terminated", signal: "SIGTERM" },
    ],
    [{ code: "EACCES" }, { category: "spawn", systemCode: "EACCES" }],
    [{ code: "private", signal: "private" }, { category: "unknown" }],
  ] as const) {
    const failure = Object.assign(Error("private command"), props, {
      stderr: "private secret",
      stdout: "private output",
      cmd: "private command",
    });
    const lines: string[] = [];
    await assert.rejects(
      observeBackendCreate(
        "warm",
        async () => {
          throw failure;
        },
        (line) => lines.push(line),
      ),
      (error) => error === failure,
    );
    assert.deepEqual(
      lines.map((line) => JSON.parse(line)),
      [{ event: "backend_create_failed", stage: "warm", ...metadata }],
    );
  }
});
test("diagnostic sink failure cannot replace the create error", async () => {
  const failure = Error("create");
  await assert.rejects(
    observeBackendCreate(
      "warm_network_retry",
      async () => {
        throw failure;
      },
      () => {
        throw Error("sink");
      },
    ),
    (error) => error === failure,
  );
});
test("known daemon reasons emit generic enums and reject ambiguous or embedded matches", async () => {
  const cases = [
    [
      "Error response from daemon: network private-network not found",
      "network_missing",
    ],
    [
      "Error response from daemon: No such image: private-image",
      "image_missing",
    ],
    [
      'Error response from daemon: Conflict. The container name "private-name" is already in use by container "private-id". You have to remove it.',
      "name_conflict",
    ],
    [
      "Error response from daemon: write private-path: no space left on device",
      "disk_exhausted",
    ],
    [
      "Error response from daemon: private-operation: resource temporarily unavailable",
      "resource_exhausted",
    ],
    [
      "Error response from daemon: private-operation: cannot allocate memory",
      "resource_exhausted",
    ],
    [
      "Cannot connect to the Docker daemon at unix:///private-path. Is the docker daemon running?",
      "daemon_unavailable",
    ],
    [
      "private diagnostic network missing image missing no space left on device",
      undefined,
    ],
    [
      "prefix Error response from daemon: No such image: private-image",
      undefined,
    ],
    [
      "Error response from daemon: No such image: private-image\nprivate extra line",
      undefined,
    ],
    [
      "Error response from daemon: network private-network not found but retrying",
      undefined,
    ],
  ] as const;
  for (const [stderr, reason] of cases) {
    const lines: string[] = [];
    const error = Object.assign(Error("private"), { code: 1, stderr });
    await assert.rejects(
      observeBackendCreate(
        "compile",
        async () => {
          throw error;
        },
        (line) => lines.push(line),
      ),
    );
    assert.deepEqual(JSON.parse(lines[0]!), {
      event: "backend_create_failed",
      stage: "compile",
      category: "exit",
      exitCode: 1,
      ...(reason ? { reason } : {}),
    });
  }
});
test("primitive failures and invalid exit codes remain bounded and preserve identity", async () => {
  for (const failure of [
    null,
    undefined,
    "private",
    42,
    { code: -1 },
    { code: 256 },
    { code: NaN },
    { code: 1.5 },
  ]) {
    const lines: string[] = [];
    let caught: unknown = Symbol();
    try {
      await observeBackendCreate(
        "warm",
        async () => {
          throw failure;
        },
        (line) => lines.push(line),
      );
    } catch (error) {
      caught = error;
    }
    assert.equal(caught, failure);
    assert.deepEqual(JSON.parse(lines[0]!), {
      event: "backend_create_failed",
      stage: "warm",
      category: "unknown",
    });
  }
});
