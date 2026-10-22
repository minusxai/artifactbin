import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  lstat,
  rm,
  symlink,
  readdir,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  createMigrationObjectStagePlan,
  stageMigrationObjects,
} from "../src/migration/object-stage.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "object-stage-")));
  const source = join(root, "source"),
    target = join(root, "target");
  await mkdir(source, { mode: 0o700 });
  await mkdir(target, { mode: 0o700 });
  const sha256 = hash("verified");
  await writeFile(join(source, sha256), "verified", { mode: 0o600 });
  const plan = createMigrationObjectStagePlan([
    { store: "media", sha256, bytes: 8 },
    { store: "datasets", sha256, bytes: 8 },
  ]);
  return { root, source, target, sha256, plan };
}
const owner = { uid: process.getuid!(), gid: process.getgid!() };
test("hash-bound staging creates both stores exclusively and resumes without changing bytes", async () => {
  const f = await fixture();
  try {
    const run = () =>
      stageMigrationObjects(f.plan, {
        sourceDirectory: f.source,
        targetRoot: f.target,
        expectedPlanSha256: f.plan.sha256,
        ...owner,
      });
    assert.equal((await run()).created, 2);
    assert.equal((await run()).reused, 2);
    for (const store of ["media", "datasets"]) {
      assert.equal(
        await readFile(join(f.target, store, f.sha256), "utf8"),
        "verified",
      );
      assert.equal(
        (await lstat(join(f.target, store, f.sha256))).mode & 0o777,
        0o600,
      );
      assert.equal((await lstat(join(f.target, store))).mode & 0o777, 0o700);
    }
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
test("tampered plans and source bytes refuse before any target objects appear", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      stageMigrationObjects(
        { ...f.plan, bytes: 1 },
        {
          sourceDirectory: f.source,
          targetRoot: f.target,
          expectedPlanSha256: f.plan.sha256,
          ...owner,
        },
      ),
    );
    await writeFile(join(f.source, f.sha256), "tampered");
    await assert.rejects(
      stageMigrationObjects(f.plan, {
        sourceDirectory: f.source,
        targetRoot: f.target,
        expectedPlanSha256: f.plan.sha256,
        ...owner,
      }),
    );
    assert.deepEqual(await readdir(f.target), []);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
test("conflicting destination and symlink roots refuse without overwriting", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.target, "media"));
    await writeFile(join(f.target, "media", f.sha256), "conflict");
    await assert.rejects(
      stageMigrationObjects(f.plan, {
        sourceDirectory: f.source,
        targetRoot: f.target,
        expectedPlanSha256: f.plan.sha256,
        ...owner,
      }),
    );
    assert.equal(
      await readFile(join(f.target, "media", f.sha256), "utf8"),
      "conflict",
    );
    await rm(join(f.target, "media"), { recursive: true });
    await symlink(f.source, join(f.target, "media"));
    await assert.rejects(
      stageMigrationObjects(f.plan, {
        sourceDirectory: f.source,
        targetRoot: f.target,
        expectedPlanSha256: f.plan.sha256,
        ...owner,
      }),
    );
    assert.equal(await readFile(join(f.source, f.sha256), "utf8"), "verified");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("approved digest and consistent cross-store lengths are mandatory; source symlinks fail closed", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      stageMigrationObjects(f.plan, {
        sourceDirectory: f.source,
        targetRoot: f.target,
        ...owner,
        expectedPlanSha256: "0".repeat(64),
      }),
      /approved digest/,
    );
    assert.throws(() =>
      createMigrationObjectStagePlan([
        { store: "media", sha256: f.sha256, bytes: 8 },
        { store: "datasets", sha256: f.sha256, bytes: 9 },
      ]),
    );
    await rm(join(f.source, f.sha256));
    await writeFile(join(f.root, "outside"), "verified");
    await symlink(join(f.root, "outside"), join(f.source, f.sha256));
    await assert.rejects(
      stageMigrationObjects(f.plan, {
        sourceDirectory: f.source,
        targetRoot: f.target,
        ...owner,
        expectedPlanSha256: f.plan.sha256,
      }),
    );
    assert.deepEqual(await readdir(f.target), []);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
