import { createHash } from "node:crypto";
import { archivedCompilerIdentity } from "./cache.ts";
import { verifyCapturedFontBundle } from "./conversion/compiled/fonts/verify.ts";
import type { MigrationJobOptions } from "./job-contracts.ts";

/** Reopen external resources on every provenance check, including checks before cache use. */
export async function migrationCompilerIdentity(
  options: Pick<
    MigrationJobOptions,
    | "archivedRoot"
    | "fontBundle"
    | "sourceAdmission"
    | "legacyDuckSqlAdmissions"
  >,
  identify?: () => Promise<string>,
): Promise<string> {
  const resourceDigest = options.fontBundle
    ? (await verifyCapturedFontBundle(options.fontBundle)).resourceDigest
    : undefined;
  const identifyBase = async () => {
    if (!identify)
      return archivedCompilerIdentity(options.archivedRoot ?? "", {
        migrationRoot: new URL("../../", import.meta.url).pathname,
        compilerResourceDigest: resourceDigest,
      });
    const identity = await identify();
    return resourceDigest
      ? createHash("sha256")
          .update(
            JSON.stringify([
              "migration-resource-closure-v1",
              identity,
              resourceDigest,
            ]),
          )
          .digest("hex")
      : identity;
  };
  const baseIdentity = await identifyBase();
  const identity = options.legacyDuckSqlAdmissions?.length
    ? createHash("sha256")
        .update(
          JSON.stringify([
            "migration-duckdb-admissions-v1",
            baseIdentity,
            options.legacyDuckSqlAdmissions,
          ]),
        )
        .digest("hex")
    : baseIdentity;
  return options.sourceAdmission === "offline-prototype"
    ? createHash("sha256")
        .update(
          JSON.stringify([
            "migration-source-admission-v1",
            "offline-prototype",
            identity,
          ]),
        )
        .digest("hex")
    : identity;
}
