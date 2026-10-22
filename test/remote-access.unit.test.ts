import test from "node:test";
import assert from "node:assert/strict";
import { remoteAccessSnapshot } from "../src/browser/remote-access.ts";
test("platform access projects exact settled policy and lifecycle without requiring an account identity", () => {
  const base = {
    epoch: 1,
    active: true,
    historical: false,
    phase: "pending" as const,
    context: null,
  };
  assert.equal(remoteAccessSnapshot(base).state, "pending");
  assert.deepEqual(
    remoteAccessSnapshot({
      ...base,
      phase: "allowed",
      context: "guest-policy",
    }),
    { epoch: 1, state: "allowed", context: "guest-policy" },
  );
  for (const phase of ["denied", "disconnected", "disposed"] as const)
    assert.equal(
      remoteAccessSnapshot({ ...base, phase, context: "stale" }).state,
      phase,
    );
  assert.equal(
    remoteAccessSnapshot({ ...base, active: false, context: "stale" }).state,
    "denied",
  );
  assert.equal(
    remoteAccessSnapshot({ ...base, historical: true, context: "stale" }).state,
    "denied",
  );
});

test("identity replacement and verified caller rotation advance only an opaque generation", async () => {
  const { createRemoteAccess } = await import(
    "../src/browser/remote-access.ts"
  );
  const owner = createRemoteAccess();
  const input = {
    active: true,
    historical: false,
    phase: "allowed" as const,
    context: "first",
  };
  const first = owner.project(input);
  assert.equal(owner.project(input).epoch, first.epoch);
  const pending = owner.invalidate();
  assert.notEqual(pending.epoch, first.epoch);
  assert.equal(pending.context, null);
  const second = owner.project({ ...input, context: "second" });
  assert.equal(second.epoch, pending.epoch);
  assert.notEqual(
    owner.project({ ...input, context: "rotated" }).epoch,
    second.epoch,
  );
});
