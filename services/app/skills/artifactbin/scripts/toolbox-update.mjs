/** Internal: shared release update and command dispatch. Used by all command entry points. */
import path from "node:path";
import {mkdir, writeFile, rename, realpath, rm, readdir} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { limit, hex, decodeRelease } from "./toolbox-update-archive.mjs";
import { json, atomic, context, locked, verified, activate } from "./toolbox-update-state.mjs";
async function fetchBytes(url, max) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "error" });
  if (!response.ok) throw Error("Update HTTP " + response.status);
  let size = 0;
  const parts = [];
  for await (const part of response.body) {
    size += part.length;
    if (size > max) throw Error("Update exceeds size limit");
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts);
}
export async function update(root, { background = false, rollback = false } = {}) {
  const c = await context(root);
  return locked(c, async () => {
    Object.assign(c, await context(root));
    // Keep only the active, previous (rollback) and pending releases; drop the rest and old stages.
    const keep = new Set([path.basename(path.dirname(c.root))]);
    for (const file of ["previous.json", "pending.json"])
      try {
        keep.add((await json(path.join(c.state, file))).directory);
      } catch {}
    for (const name of await readdir(c.state)) {
      const release = /^(release|install)-[A-Za-z0-9-]+$/.test(name) && !keep.has(name);
      if (release || /^stage-[a-f0-9-]+$/.test(name))
        await rm(path.join(c.state, name), { recursive: true, force: true });
    }
    if (rollback) {
      await atomic(path.join(c.state, "checked.json"), { time: Date.now() });
      const previous = await json(path.join(c.state, "previous.json"));
      await activate(c, previous.directory);
      await rm(path.join(c.state, "pending.json"), { force: true });
      return { status: "rolled-back" };
    }
    const manifest = JSON.parse(
      (
        await fetchBytes(c.release.origin + "/skills/artifactbin/latest.json", 16384)
      ).toString(),
    );
    if (
      manifest.schemaVersion !== 1 ||
      manifest.origin !== c.release.origin ||
      manifest.url !== c.release.origin + "/skills/artifactbin.zip" ||
      !hex(manifest.version)
    )
      throw Error("Invalid update manifest");
    await atomic(path.join(c.state, "checked.json"), { time: Date.now() });
    if (manifest.version === c.release.version) return { status: "current" };
    let pending;
    try {
      pending = await json(path.join(c.state, "pending.json"));
      const pendingRoot = await verified(c, pending.directory);
      if ((await json(path.join(pendingRoot, "release.json"))).version !== manifest.version)
        pending = null;
    } catch {
      pending = null;
    }
    if (pending) {
      if (!background) {
        await activate(c, pending.directory);
        await rm(path.join(c.state, "pending.json"), { force: true });
      }
      return { status: background ? "staged" : "activated", version: manifest.version };
    }
    const bytes = await fetchBytes(manifest.url, limit),
      files = decodeRelease(bytes, manifest);
    const directory = "release-" + randomUUID(),
      stage = path.join(c.state, directory.replace("release-", "stage-")),
      releaseRoot = path.join(stage, "artifactbin");
    await mkdir(releaseRoot, { recursive: true, mode: 0o700 });
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(releaseRoot, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, { flag: "wx", mode: 0o600 });
    }

    await rename(stage, path.join(c.state, directory));
    if (background) await atomic(path.join(c.state, "pending.json"), { directory });
    else {
      await activate(c, directory);
      await rm(path.join(c.state, "pending.json"), { force: true });
    }
    return { status: background ? "staged" : "activated", version: manifest.version };
  });
}
export const disabled = (args) =>
  args.includes("--no-update") ||
  /^(1|true|yes)$/i.test(process.env.ARTIFACTBIN__NO_UPDATE || "");
export async function beforeCommand(url, args) {
  if (
    args.includes("--help") ||
    process.env.ARTIFACTBIN__UPDATE_DISPATCHED === fileURLToPath(url)
  )
    return false;
  let c;
  try {
    c = await context(fileURLToPath(new URL("../", url)));
  } catch {
    return false;
  }
  const server =
    args.find((a) => a.startsWith("--server="))?.slice(9) ??
    args[args.indexOf("--server") + 1];
  const allowed =
    !disabled(args) &&
    (!args.some((a) => a === "--server" || a.startsWith("--server=")) ||
      server === c.release.origin);
  if (allowed)
    try {
      await locked(
        c,
        async () => {
          try {
            const pending = await json(path.join(c.state, "pending.json"));
            await activate(c, pending.directory);
          } catch {
          } finally {
            await rm(path.join(c.state, "pending.json"), { force: true });
          }
          let checked = 0;
          try {
            checked = (await json(path.join(c.state, "checked.json"))).time;
          } catch {}
          if (Date.now() - checked > 3600000) {
            await atomic(path.join(c.state, "checked.json"), { time: Date.now() });
            const child = spawn(
              process.execPath,
              [path.join(await realpath(c.canonical), "scripts/update.mjs"), "--background"],
              { stdio: "ignore", detached: true },
            );
            child.on("error", () => {});
            child.unref();
          }
        },
        false,
      );
    } catch {}
  const active = await realpath(c.canonical),
    original = fileURLToPath(new URL("../", url));
  if (active === (await realpath(original))) return false;
  const script = path.join(active, "scripts", path.basename(fileURLToPath(url)));
  const child = spawn(process.execPath, [script, ...args, "--no-update"], {
    stdio: "inherit",
    env: { ...process.env, ARTIFACTBIN__UPDATE_DISPATCHED: script },
  });
  const forward = (signal) => child.kill(signal),
    handlers = new Map(
      ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => [signal, () => forward(signal)]),
    );
  for (const [signal, handler] of handlers) process.on(signal, handler);
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
  } finally {
    // Remove the forwarders before re-raising, or a listener would swallow the signal.
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.code;
  return true;
}
