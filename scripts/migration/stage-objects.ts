import { readFile } from "node:fs/promises";
import { stageMigrationObjects } from "../../src/migration/object-stage.ts";
import type { MigrationObjectStagePlan } from "../../src/migration/object-stage-contracts.ts";
const [manifest, sourceDirectory, targetRoot, expectedPlanSha256, uid, gid] =
  process.argv.slice(2);
if (
  !manifest ||
  !sourceDirectory ||
  !targetRoot ||
  !expectedPlanSha256 ||
  !uid ||
  !gid ||
  process.argv.length !== 8
)
  throw Error(
    "Usage: stage-objects.ts MANIFEST SOURCE_DIRECTORY TARGET_ROOT APPROVED_SHA256 UID GID",
  );
const plan = JSON.parse(
  await readFile(manifest, "utf8"),
) as MigrationObjectStagePlan;
console.log(
  JSON.stringify(
    await stageMigrationObjects(plan, {
      sourceDirectory,
      targetRoot,
      expectedPlanSha256,
      uid: Number(uid),
      gid: Number(gid),
    }),
  ),
);
