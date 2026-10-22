import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import type {
  BackendContextFingerprintOptions,
  DatasetSqlContextFingerprintOptions,
  ImageProcessorContextFingerprintOptions,
} from "./contracts.ts";
/** Include paths, modes, hidden files and bytes so a changed Docker context cannot reuse an older image. */
export function backendContextFingerprint({
  root,
  platform,
  architecture,
}: BackendContextFingerprintOptions): string {
  const hash = createHash("sha256").update(
    JSON.stringify([platform, architecture]),
  );
  function visit(relative: string): void {
    const absolute = join(root, relative),
      stat = lstatSync(absolute);
    hash.update(
      JSON.stringify([
        relative,
        stat.mode,
        stat.isDirectory() ? null : stat.size,
      ]),
    );
    if (stat.isDirectory())
      for (const name of readdirSync(absolute).sort())
        visit(join(relative, name));
    else if (stat.isSymbolicLink()) hash.update(readlinkSync(absolute));
    else hash.update(readFileSync(absolute));
  }
  visit("");
  return hash.digest("hex");
}

/** The SQL image copies its engine tree and the mutation wire contract from the project context. */
export function datasetSqlContextFingerprint(
  options: DatasetSqlContextFingerprintOptions,
): string {
  const hash = createHash("sha256");
  for (const relative of [
    ".dockerignore",
    "src/datasets/sql",
    "src/datasets/mutation/contracts.ts",
  ])
    hash.update(relative).update(
      backendContextFingerprint({
        ...options,
        root: join(options.root, relative),
      }),
    );
  return hash.digest("hex");
}

/** The fixed decoder image copies only its sandbox source tree. */
export function imageProcessorContextFingerprint(
  options: ImageProcessorContextFingerprintOptions,
): string {
  const hash = createHash("sha256");
  for (const relative of [".dockerignore", "src/media/image-processing"])
    hash
      .update(relative)
      .update(
        backendContextFingerprint({
          ...options,
          root: join(options.root, relative),
        }),
      );
  return hash.digest("hex");
}
