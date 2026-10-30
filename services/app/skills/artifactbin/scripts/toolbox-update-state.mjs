/** Internal: immutable release pointers and locking. Used by toolbox-update.mjs. */
import path from "node:path";
import {readFile, writeFile, rename, realpath,
 symlink, lstat, rm, readdir, readlink} from "node:fs/promises";
import { hash, hex, member } from "./toolbox-update-archive.mjs";
export async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
export async function atomic(file, value) {
  const temporary = file + ".tmp";
  await rm(temporary, { force: true });
  await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
  await rename(temporary, file);
}
export async function context(root) {
  root = await realpath(root);
  const state = path.dirname(path.dirname(root)),
    canonical = path.join(path.dirname(state), "artifactbin");
  if (
    path.basename(root) !== "artifactbin" ||
    path.basename(state) !== ".artifactbin-releases" ||
    !(await lstat(canonical)).isSymbolicLink()
  )
    throw Error("Unmanaged installation. Reinstall using the installer to enable updates.");
  const release = await json(path.join(root, "release.json"));
  const active = await realpath(canonical);
  if (path.dirname(path.dirname(active)) !== state || path.basename(active) !== "artifactbin")
    throw Error("Invalid canonical release pointer");
  for (const directory of [state, root, active])
    if ((await lstat(directory)).uid !== process.getuid?.())
      throw Error("Release ownership mismatch");
  const current = await json(path.join(active, "release.json"));
  if (
    release.schemaVersion !== 1 ||
    !hex(release.version) ||
    new URL(release.origin).origin !== release.origin ||
    current.origin !== release.origin
  )
    throw Error("Invalid installed release");
  return { root: active, release: current, state, canonical };
}
export async function locked(c, action, wait = true) {
  const lock = path.join(c.state, "lock");
  for (let attempt = 0; ; attempt++) {
    try {
      await symlink(String(process.pid), lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let pid;
      try {
        pid = Number(await readlink(lock));
      } catch (e) {
        if (e.code === "ENOENT") continue;
        throw e;
      }
      let alive = true;
      if (!Number.isSafeInteger(pid) || pid <= 0)
        throw Error("Invalid updater lock; remove it after checking no updater is running");
      if (pid > 0)
        try {
          process.kill(pid, 0);
        } catch (e) {
          if (e.code === "ESRCH") alive = false;
        }
      if (!alive) {
        await rm(lock, { force: true });
        continue;
      }
      if (!wait) return;
      if (attempt >= 200) throw Error("Update busy; retry later");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await action();
  } finally {
    await rm(lock, { force: true });
  }
}
export async function verified(c, directory) {
  if (
    typeof directory !== "string" ||
    !directory ||
    directory === "." ||
    directory === ".." ||
    path.basename(directory) !== directory
  )
    throw Error("Invalid release pointer");
  const root = path.join(c.state, directory, "artifactbin"),
    files = [];
  if ((await realpath(root)) !== root || (await lstat(root)).uid !== process.getuid?.())
    throw Error("Invalid release ownership or path");
  async function walk(folder, prefix = "") {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = prefix + entry.name,
        target = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(target, name + "/");
      else if (entry.isFile() && member.test(name)) {
        if (name !== "release.json") files.push([name, await readFile(target, "utf8")]);
      } else throw Error("Unsafe installed release member");
    }
  }
  await walk(root);
  const release = await json(path.join(root, "release.json"));
  if (
    release.schemaVersion !== 1 ||
    release.origin !== c.release.origin ||
    hash(JSON.stringify([release.origin, files.sort(([a], [b]) => a.localeCompare(b))])) !==
      release.version
  )
    throw Error("Release identity mismatch");
  return root;
}
export async function activate(c, directory) {
  const root = await verified(c, directory),
    previous = await realpath(c.canonical);
  if (root === previous) return;
  await atomic(path.join(c.state, "previous.json"), {
    directory: path.basename(path.dirname(previous)),
  });
  const temporary = path.join(c.state, "activate");
  await rm(temporary, { force: true });
  await symlink(root, temporary);
  await rename(temporary, c.canonical);
  process.stderr.write(
    "Skill updated. Reread " +
      path.join(c.canonical, "SKILL.md") +
      " and reload your harness.\n",
  );
}
