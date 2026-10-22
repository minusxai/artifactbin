import { createHash } from "node:crypto";
import { archivedCompilerIdentity } from "./cache.ts";
import { verifyCapturedFontBundle } from "./conversion/compiled/fonts/verify.ts";
import type { MigrationJobOptions } from "./job-contracts.ts";

/** Reopen external resources on every provenance check, including checks before cache use. */
export async function migrationCompilerIdentity(
  options: Pick<MigrationJobOptions, "archivedRoot" | "fontBundle">,
  identify?: () => Promise<string>,
): Promise<string> {
  const resourceDigest = options.fontBundle
    ? (await verifyCapturedFontBundle(options.fontBundle)).resourceDigest
    : undefined;
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
}
