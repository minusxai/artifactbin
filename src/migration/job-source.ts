import { readVerifiedSupplementalAssets } from "./assets/supplemental.ts";
import { projectSupplementalAssets } from "./assets/projection.ts";
import { preservedOrphanActor } from "./orphans.ts";
import { readMigrationDatasetSource } from "./dataset-source.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readStreamManifest, readPartRows } from "./stream.ts";
import {
  indexStreamArchive,
  indexedArtifactIds,
  indexedArtifactHeaders,
  readIndexedAccounts,
  readIndexedArtifact,
  readIndexedArtifactHead,
} from "./stream-index.ts";
import { buildAccountMaps } from "./postgres.ts";
import { allocateMigrationMaps } from "./import.ts";
import { planMigrationIdentities } from "./identities.ts";
import { planMigrationGroups } from "./groups.ts";
import { readMigrationMedia, migrationResourceMap } from "./media.ts";
import type { MigrationManifest } from "./contracts.ts";
import type {
  MigrationJobOptions,
  MigrationJobSource,
} from "./job-contracts.ts";
export async function prepareMigrationJobSource(
  options: MigrationJobOptions,
): Promise<MigrationJobSource> {
  const manifest = await readStreamManifest(options.sourceDirectory);
  const authorityTables: Record<string, import("./contracts.ts").LegacyRow[]> =
    {};
  for (const name of [
    "groups",
    "group_members",
    "group_links",
    ...(options.supplementalAssets ? ["comment_images"] : []),
  ]) {
    authorityTables[name] = [];
    for (const part of manifest.parts.filter((p) => p.table === name))
      for await (const row of readPartRows(options.sourceDirectory, part))
        authorityTables[name]!.push(row);
  }
  try {
    const indexed = JSON.parse(
      await readFile(join(options.indexDirectory, "manifest.json"), "utf8"),
    );
    if (JSON.stringify(indexed) !== JSON.stringify(manifest))
      throw new Error("Index belongs to another source snapshot");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await indexStreamArchive(
      options.sourceDirectory,
      options.indexDirectory,
      manifest,
    );
  }
  const accounts = await readIndexedAccounts(options.indexDirectory);
  const base: MigrationManifest = {
    schemaVersion: 1,
    sourceNamespace: manifest.sourceNamespace,
    exportedAt: manifest.exportedAt,
    tables: { users: accounts.users, ...authorityTables },
    tokenOwners: accounts.tokenOwners,
    artifacts: [],
  };
  const ids: string[] = [];
  for await (const id of indexedArtifactIds(options.indexDirectory))
    ids.push(id);
  const maps = allocateMigrationMaps(
    manifest.sourceNamespace,
    ids,
    buildAccountMaps(base),
  );
  const identities = planMigrationIdentities(base).identities;
  const groups = planMigrationGroups(base, maps.users);
  const groupSummary = {
    mapped: groups.groups.length,
    active: groups.groups.filter((g) => g.active).length,
    inactive: groups.groups.filter((g) => !g.active).length,
    blocked: groups.blocked.length,
    memberships: groups.groups.reduce((n, g) => n + g.members.length, 0),
  };
  const identitySummary = {
    emailLogin: identities.filter((i) => i.classification === "email-login")
      .length,
    preservedNonlogin: identities.filter(
      (i) => i.classification === "preserved-nonlogin",
    ).length,
    blocked: identities.filter((i) => i.classification === "blocked").length,
  };
  // Only small account/ID metadata is retained across artifacts, never document/history/edit bodies.
  let preservedOrphans = 0;
  for await (const header of indexedArtifactHeaders(options.indexDirectory)) {
    const head = await readIndexedArtifactHead(
      options.indexDirectory,
      header.id,
    );
    const orphan = preservedOrphanActor(manifest.sourceNamespace, head);
    if (orphan) {
      maps.orphans ??= {};
      maps.orphans[head.id] = orphan;
      preservedOrphans++;
    }
    if (header.format === "folder") base.artifacts.push(head);
  }
  Object.assign(identitySummary, { preservedOrphans });
  const media = options.media
    ? await readMigrationMedia(
        options.media.planPath,
        options.media.receiptsPath,
      )
    : null;
  const resourceMap = media
    ? migrationResourceMap(
        media.assets,
        maps.pages,
        options.origin,
        options.legacyOrigins,
      )
    : undefined;
  const datasets = options.datasets
    ? await readMigrationDatasetSource({
        baseDirectory: options.sourceDirectory,
        base: manifest,
        relationDirectory: options.datasets.relationDirectory,
        receiptsPath: options.datasets.receiptsPath,
      })
    : undefined;
  if (options.supplementalAssets && !datasets)
    throw Error(
      "Supplemental profile projection requires dataset metadata destination",
    );
  const supplementalAssets = options.supplementalAssets
    ? projectSupplementalAssets(
        manifest.sourceNamespace,
        accounts.users,
        authorityTables.comment_images ?? [],
        await readVerifiedSupplementalAssets(
          options.supplementalAssets.receiptsPath,
          options.supplementalAssets.objectsDirectory,
        ),
      )
    : undefined;
  return {
    supplementalAssets,
    datasets,
    manifest,
    base,
    maps,
    ids,
    identitySummary,
    groupSummary,
    media,
    resourceMap,
    readArtifact: (id) =>
      readIndexedArtifact(options.indexDirectory, manifest, id),
  };
}
