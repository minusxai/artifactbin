/** The controller's startup cleanup removes only containers it can prove are its own, and proves they are gone. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DockerCommand, ReapBackendContainers } from "../../../src/backend/execution-contracts.ts";
import { load } from "../support/load.ts";

const reaper = () => load<{ reapBackendContainers: ReapBackendContainers }>("src/backend/reaper.ts");
const ID = "a".repeat(12);
const NAME = "/pagegi-backend-01234567-89ab-cdef-0123-456789abcdef";
const owned = (over: Record<string, unknown> = {}) => ({ Id: ID + "b".repeat(52), Name: NAME, Config: { Labels: { "pagegi.backend": "1" } }, ...over });

function fakeDocker(options: { ids?: string; inspected?: unknown; remaining?: string; rmFails?: boolean } = {}) {
  const calls: { args: readonly string[]; timeoutMs?: number }[] = [];
  let listed = false;
  const docker: DockerCommand = async (args, timeoutMs) => {
    calls.push({ args, timeoutMs });
    if (args[0] === "ps") {
      const result = listed ? (options.remaining ?? "") : (options.ids ?? ID);
      listed = true;
      return result;
    }
    if (args[0] === "inspect") return JSON.stringify(options.inspected ?? [owned()]);
    if (args[0] === "rm") {
      if (options.rmFails) throw Error("docker rm timed out");
      return ID;
    }
    throw Error("unexpected docker command " + args.join(" "));
  };
  return { docker, calls, removed: () => calls.filter((c) => c.args[0] === "rm").map((c) => c.args) };
}

test("an owned container is removed and its absence verified, with bounded timeouts", async () => {
  const { reapBackendContainers } = await reaper();
  const fake = fakeDocker();
  assert.equal(await reapBackendContainers(fake.docker), 1);
  assert.deepEqual(fake.removed(), [["rm", "-f", ID]]);
  for (const call of fake.calls) {
    if (call.args[0] === "ps") assert.deepEqual(call.args.slice(1), ["-aq", "--filter", "label=pagegi.backend=1"]);
    assert.ok((call.timeoutMs ?? 0) > 0 && (call.timeoutMs ?? 0) <= 10_000, call.args.join(" "));
  }
});

test("with no owned containers nothing is removed", async () => {
  const { reapBackendContainers } = await reaper();
  const fake = fakeDocker({ ids: "" });
  assert.equal(await reapBackendContainers(fake.docker), 0);
  assert.deepEqual(fake.removed(), []);
});

test("a malformed inventory is refused before anything is inspected or removed", async () => {
  const { reapBackendContainers } = await reaper();
  for (const ids of ["not-an-id", ID + ";rm", ID + "\n" + ID, Array.from({ length: 1025 }, (_, i) => i.toString(16).padStart(12, "0")).join("\n")]) {
    const fake = fakeDocker({ ids });
    await assert.rejects(reapBackendContainers(fake.docker), /inventory/, ids);
    assert.equal(fake.calls.length, 1, ids);
  }
});

test("a container with the wrong label or name is never removed", async () => {
  const { reapBackendContainers } = await reaper();
  for (const [label, name] of [["0", NAME], ["1", "/database"], ["1", NAME + "-extra"], ["1", "/pagegi-backend-" + "a".repeat(36)]]) {
    const fake = fakeDocker({ inspected: [owned({ Name: name, Config: { Labels: { "pagegi.backend": label } } })] });
    await assert.rejects(reapBackendContainers(fake.docker), /ownership/, `${label} ${name}`);
    assert.deepEqual(fake.removed(), []);
  }
});

test("a removal failure or a container that remains afterwards is a failure", async () => {
  const { reapBackendContainers } = await reaper();
  await assert.rejects(reapBackendContainers(fakeDocker({ rmFails: true }).docker), /timed out/);
  await assert.rejects(reapBackendContainers(fakeDocker({ remaining: ID }).docker), /incomplete/);
});

test("missing, partial or mismatched inspection never removes anything", async () => {
  const { reapBackendContainers } = await reaper();
  for (const inspected of [[{}], [], [owned(), owned()], [owned({ Id: "c".repeat(64) })], { unexpected: owned() }]) {
    const fake = fakeDocker({ inspected });
    await assert.rejects(reapBackendContainers(fake.docker), JSON.stringify(inspected));
    assert.deepEqual(fake.removed(), [], JSON.stringify(inspected));
  }
  const two = fakeDocker({ ids: ID + "\n" + "c".repeat(12), inspected: [owned()] });
  await assert.rejects(reapBackendContainers(two.docker));
  assert.deepEqual(two.removed(), []);
});


function inventoryDocker(count: number, foreignLast = false, failRemoval = false) {
  const ids = Array.from({ length: count }, (_, i) => i.toString(16).padStart(64, "0"));
  const calls: string[][] = [];
  const remaining = new Set(ids);
  const docker: DockerCommand = async (args) => {
    calls.push([...args]);
    if (args[0] === "ps") return [...remaining].join("\n");
    if (args[0] === "inspect") return JSON.stringify(args.slice(1).map((id) => owned({
      Id: id,
      ...(foreignLast && id === ids.at(-1) ? { Config: { Labels: { "pagegi.backend": "0" } } } : {}),
    })));
    if (args[0] === "rm") {
      if (failRemoval) throw Error("cleanup failed");
      for (const id of args.slice(2)) remaining.delete(id);
      return "";
    }
    throw Error("unexpected command");
  };
  return { docker, calls };
}

test("legitimate warm plus active inventory is fully validated before bounded cleanup", async () => {
  const { reapBackendContainers } = await reaper();
  const fake = inventoryDocker(40);
  assert.equal(await reapBackendContainers(fake.docker), 40);
  const firstRemoval = fake.calls.findIndex((args) => args[0] === "rm");
  assert.equal(fake.calls.slice(0, firstRemoval).filter((args) => args[0] === "inspect").flatMap((args) => args.slice(1)).length, 40);
  assert.ok(fake.calls.filter((args) => args[0] === "inspect").every((args) => args.length <= 17));
  assert.ok(fake.calls.filter((args) => args[0] === "rm").every((args) => args.length <= 18));
});

test("foreign ownership in a later batch prevents every removal", async () => {
  const { reapBackendContainers } = await reaper();
  const fake = inventoryDocker(40, true);
  await assert.rejects(reapBackendContainers(fake.docker), /ownership/);
  assert.equal(fake.calls.filter((args) => args[0] === "rm").length, 0);
});

test("large inventory cleanup failures reject and stop subsequent removal", async () => {
  const { reapBackendContainers } = await reaper();
  const fake = inventoryDocker(40, false, true);
  await assert.rejects(reapBackendContainers(fake.docker), /cleanup failed/);
  assert.equal(fake.calls.filter((args) => args[0] === "rm").length, 1);
});

test("the overall deadline includes command time and prevents late removal", async () => {
  const { reapBackendContainers } = await reaper();
  const fake = inventoryDocker(40);
  let now = 0;
  const timeouts: number[] = [];
  await assert.rejects(reapBackendContainers(async (args, timeout) => {
    timeouts.push(timeout!);
    const result = await fake.docker(args, timeout);
    now += 10_000;
    return result;
  }, { now: () => now }), /deadline/);
  assert.equal(fake.calls.filter((args) => args[0] === "rm").length, 0);
  assert.ok(timeouts.every((timeout) => timeout > 0 && timeout <= 10_000));
});

test("ambiguous listed ID prefixes across batches never permit removal", async () => {
  const { reapBackendContainers } = await reaper();
  const ids = Array.from({ length: 17 }, (_, i) => i.toString(16).padStart(64, "0"));
  ids[16] = ids[0]!.slice(0, 12);
  const fake = fakeDocker({ ids: ids.join("\n"), inspected: ids.slice(0, 16).map((Id) => owned({ Id })) });
  await assert.rejects(reapBackendContainers(fake.docker), /ownership/);
  assert.deepEqual(fake.removed(), []);
});

test("fractional remaining budgets become positive integer CLI timeouts, never zero", async () => {
  const { reapBackendContainers } = await reaper();
  let clock = 0;
  const timeouts: number[] = [];
  await assert.rejects(reapBackendContainers(async (_args, timeout) => {
    timeouts.push(timeout!);
    clock = timeouts.length === 1 ? 29_998.5 : 29_999.5;
    return timeouts.length === 1 ? ID : JSON.stringify([owned()]);
  }, { now: () => clock }), /deadline/);
  assert.deepEqual(timeouts, [3000, 1]);
  assert.ok(timeouts.every((timeout) => Number.isInteger(timeout) && timeout > 0));
});

test("a final listing that comes back empty just past the deadline still proves cleanup", async () => {
  const { reapBackendContainers } = await reaper();
  for (const remaining of ["", ID]) {
    const fake = fakeDocker({ remaining });
    let clock = 0;
    let listings = 0;
    const result = reapBackendContainers(async (args, timeout) => {
      const output = await fake.docker(args, timeout);
      if (args[0] === "ps" && ++listings === 2) clock = 30_001;
      return output;
    }, { now: () => clock });
    if (remaining) await assert.rejects(result, /incomplete/);
    else assert.equal(await result, 1);
    assert.deepEqual(fake.removed(), [["rm", "-f", ID]]);
  }
});

test("deployment cleanup selects only its namespace and refuses legacy containers", async () => {
  const { reapBackendContainers } = await reaper();
  const isolated = fakeDocker({
    inspected: [
      owned({
        Name: NAME.replace("pagegi-", "artefactv2-"),
        Config: { Labels: { "artefactv2.backend": "1" } },
      }),
    ],
  });
  assert.equal(
    await reapBackendContainers(isolated.docker, {
      deploymentNamespace: "artefactv2",
    }),
    1,
  );
  assert.equal(isolated.calls[0]?.args.at(-1), "label=artefactv2.backend=1");
  const legacy = fakeDocker();
  await assert.rejects(
    reapBackendContainers(legacy.docker, { deploymentNamespace: "artefactv2" }),
    /ownership/,
  );
  assert.deepEqual(legacy.removed(), []);
});
test("invalid deployment identities fail before Docker is called", async () => {
  const { reapBackendContainers } = await reaper();
  for (const deploymentNamespace of ["", "A", "a;rm", "a/b", "a".repeat(13)]) {
    const fake = fakeDocker();
    await assert.rejects(
      reapBackendContainers(fake.docker, { deploymentNamespace }),
      /namespace/,
    );
    assert.equal(fake.calls.length, 0);
  }
});
