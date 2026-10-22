import test from "node:test";
import assert from "node:assert/strict";
import { removeBackendContainer } from "../../../src/backend/container-cleanup.ts";
import type { DockerCommand } from "../../../src/backend/execution-contracts.ts";
const absent = () =>
  Object.assign(Error("missing"), { stderr: "Error: No such object: sandbox" });
test("concurrent removal rejection is harmless only once inspection proves the container absent", async () => {
  const commands: string[] = [];
  const docker: DockerCommand = async (args) => {
    commands.push(args[0]!);
    if (args[0] === "rm")
      throw Object.assign(Error("removal in progress"), {
        stderr:
          "Error response from daemon: removal of container sandbox is already in progress",
      });
    throw absent();
  };
  assert.equal(await removeBackendContainer(docker, "sandbox"), true);
  assert.deepEqual(commands, ["rm", "inspect"]);
});
test("successful removal and already absent containers both require definitive inspection", async () => {
  for (const missingAtRemoval of [false, true]) {
    const docker: DockerCommand = async (args) => {
      if (args[0] === "inspect" || missingAtRemoval) throw absent();
      return "sandbox";
    };
    assert.equal(await removeBackendContainer(docker, "sandbox"), true);
  }
});
test("present containers, unknown daemon errors and timed out inspections stay fail closed", async () => {
  for (const removalFails of [false, true])
    for (const inspection of ["present", "daemon", "timeout"]) {
      const docker: DockerCommand = async (args) => {
        if (args[0] === "rm") {
          if (removalFails) throw Error("daemon disconnected");
          return "sandbox";
        }
        if (inspection === "present") return "[{}]";
        if (inspection === "timeout")
          throw Object.assign(Error("timed out"), {
            killed: true,
            signal: "SIGTERM",
            stderr: "No such object: sandbox",
          });
        throw Object.assign(Error("daemon disconnected"), {
          stderr: "Cannot connect to the Docker daemon",
        });
      };
      assert.equal(await removeBackendContainer(docker, "sandbox"), false);
    }
});
