import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readStreamManifest, readPartRows } from "./stream.ts";
import { PostgresStreamArchive } from "./stream-postgres.ts";
import type { SqlReader } from "./contracts.ts";
import type {
  MigrationArchiveInputs,
  MigrationArchiveSource,
} from "./archive-contracts.ts";
export async function readMigrationArchiveSources(
  inputs: MigrationArchiveInputs,
): Promise<MigrationArchiveSource[]> {
  async function read(
    directory: string,
    kind: MigrationArchiveSource["kind"],
  ): Promise<MigrationArchiveSource> {
    const bytes = await readFile(join(directory, "manifest.json"));
    const manifest = await readStreamManifest(directory);
    const originalManifest = JSON.parse(bytes.toString("utf8"));
    if (!bytes.equals(await readFile(join(directory, "manifest.json"))))
      throw Error("Source manifest changed while reading");
    return {
      directory,
      kind,
      manifest,
      originalManifest,
      manifestSha256: createHash("sha256").update(bytes).digest("hex"),
      namespace:
        manifest.sourceNamespace +
        (kind === "base" ? "" : ":supplemental-relations"),
    };
  }
  const base = await read(inputs.baseDirectory, "base");
  if (!inputs.relationDirectory) return [base];
  const supplement = await read(
    inputs.relationDirectory,
    "supplemental-relations",
  );
  if (
    supplement.manifest.sourceNamespace !== base.manifest.sourceNamespace ||
    supplement.manifest.schema !== base.manifest.schema ||
    supplement.originalManifest.supplemental !== true ||
    supplement.originalManifest.consistency !==
      "independent-repeatable-read-read-only" ||
    supplement.originalManifest.supplementsExportedAt !==
      base.manifest.exportedAt ||
    supplement.manifest.parts.some((p) => p.table !== "relations")
  )
    throw Error("Supplemental archive provenance mismatch");
  return [base, supplement];
}
/** Every original row is preserved, including unsupported/deleted content and independent supplemental snapshots. */
export async function archiveMigrationSources(
  db: SqlReader,
  schema: string,
  sources: readonly MigrationArchiveSource[],
): Promise<void> {
  const archive = new PostgresStreamArchive(db, schema, true);
  await archive.initialize();
  for (const source of sources) {
    await archive.archiveManifest(source);
    for (const part of source.manifest.parts)
      await archive.archivePart(
        source.namespace,
        part,
        readPartRows(source.directory, part),
      );
  }
}
