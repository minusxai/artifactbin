import test from "node:test";
import assert from "node:assert/strict";
import { createSandboxNetwork } from "../src/backend/sandbox-network.ts";
import { deploymentIdentity } from "../src/backend/deployment-identity.ts";
const identity = deploymentIdentity();
const valid = {
  Driver: "bridge",
  EnableIPv6: false,
  Options: {
    "com.docker.network.bridge.enable_icc": "false",
    "com.docker.network.bridge.name": identity.bridge,
  },
};
function fixture(network = identity.network) {
  const calls: readonly string[][] = [];
  const mutable = calls as string[][];
  let response: unknown = valid;
  let missing = false,
    createFails = false;
  const policy = createSandboxNetwork({
    network,
    identity,
    log: () => {},
    command: async (args) => {
      mutable.push([...args]);
      if (args[1] === "create") {
        if (createFails) throw Error("race");
        return { stdout: "" };
      }
      if (missing) {
        missing = false;
        throw { stderr: "No such network" };
      }
      if (response instanceof Error) throw response;
      return { stdout: JSON.stringify(response) };
    },
  });
  return {
    policy,
    calls,
    set: (v: unknown) => (response = v),
    missing: () => (missing = true),
    race: () => (createFails = true),
  };
}
test("existing bridge verification coalesces and none executes no commands", async () => {
  const f = fixture();
  const a = f.policy.ensure(),
    b = f.policy.ensure();
  assert.equal(a, b);
  await a;
  await f.policy.ensure();
  assert.equal(f.calls.length, 1);
  f.policy.invalidate();
  await f.policy.ensure();
  assert.equal(f.calls.length, 2);
  const none = fixture("none");
  await none.policy.ensure();
  assert.equal(none.calls.length, 0);
  assert.throws(() => fixture("bad network"));
});
test("network mismatch refuses and a failed check retries", async () => {
  for (const value of [
    { ...valid, Driver: "host" },
    { ...valid, EnableIPv6: true },
    { ...valid, Options: {} },
    {
      ...valid,
      Options: { ...valid.Options, "com.docker.network.bridge.name": "other" },
    },
  ]) {
    const f = fixture();
    f.set(value);
    await assert.rejects(f.policy.ensure(), { code: "backend_unavailable" });
    f.set(valid);
    await f.policy.ensure();
    assert.equal(f.calls.length, 2);
  }
  const f = fixture();
  f.set(Error("daemon unavailable"));
  await assert.rejects(f.policy.ensure());
  assert.equal(f.calls.length, 1);
});
test("missing bridge creation and creation race both require fresh inspection", async () => {
  for (const race of [false, true]) {
    const f = fixture();
    f.missing();
    if (race) f.race();
    await f.policy.ensure();
    assert.equal(f.calls.length, 3);
    assert.deepEqual(f.calls[1], [
      "network",
      "create",
      "--driver=bridge",
      "--ipv6=false",
      "--label=pagegi.sandbox=1",
      "--opt=com.docker.network.bridge.enable_icc=false",
      "--opt=com.docker.network.bridge.name=pagegi-sbx",
      identity.network,
    ]);
  }
  const f = fixture();
  f.missing();
  f.race();
  f.set({ ...valid, EnableIPv6: true });
  await assert.rejects(f.policy.ensure());
});
test("custom network requires isolation without imposing deployment bridge name", async () => {
  const f = fixture("custom");
  f.set({
    ...valid,
    Options: { "com.docker.network.bridge.enable_icc": "false" },
  });
  f.missing();
  await f.policy.ensure();
  assert.equal(
    f.calls[1]!.some((a) => a.includes("bridge.name")),
    false,
  );
});
