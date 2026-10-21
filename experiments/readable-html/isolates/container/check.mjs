import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const image = "pagegi-isolate-proof:local";
for (const mode of ["compile", "normal", "memory", "cpu", "normal"]) {
  const name = `pg-isolate-proof-${mode}-${process.pid}`;
  try {
    const p = spawnSync(
      "docker",
      [
        "run",
        "--pull=never",
        "--name",
        name,
        "--memory=256m",
        "--memory-swap=256m",
        "--cpus=0.5",
        "--pids-limit=64",
        "--network=none",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,nodev,size=16m",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--user=10001:10001",
        image,
        mode,
      ],
      { encoding: "utf8", timeout: 20000 },
    );
    assert.equal(p.status, 0, `${mode}: ${p.stderr}\n${p.stdout}`);
    const info = JSON.parse(
      spawnSync("docker", ["inspect", name], { encoding: "utf8" }).stdout,
    )[0];
    assert.equal(info.HostConfig.NetworkMode, "none");
    assert.equal(info.HostConfig.Binds, null);
    assert.equal(info.HostConfig.ReadonlyRootfs, true);
    assert.equal(info.State.Running, false);
    console.log(p.stdout.trim());
  } finally {
    const removed = spawnSync("docker", ["rm", "-f", name], {
      encoding: "utf8",
    });
    assert.equal(removed.status, 0, removed.stderr);
    const absent = spawnSync("docker", ["inspect", name], { encoding: "utf8" });
    assert.equal(absent.status, 1);
    assert.match(absent.stderr, /No such (object|container)/i);
  }
}
console.log("All disposable containers removed.");
