import { createRequire } from "node:module";
import { destinationSchemas } from "../../src/migration/destination-schema.ts";
import { runMigrationJob } from "../../src/migration/job.ts";
import type {
  MigrationJobOptions,
  MigrationJobPorts,
} from "../../src/migration/job-contracts.ts";
const [sourceDirectory, indexDirectory, schema, reportPath, ...flags] =
  process.argv.slice(2);
if (!sourceDirectory || !indexDirectory || !schema || !reportPath)
  throw new Error(
    "Usage: node --experimental-strip-types scripts/migration/import-stream.ts <private-export-directory> <private-index-directory> <dedicated-schema> <new-private-report.ndjson> [--apply-isolated|--verify-isolated] [--editor-manage-restricted] [--conversion-strategy=strict|archived-static|archived-functional] [--concurrency=1|2]",
  );
destinationSchemas(schema);
const allowed = [
  "--apply-isolated",
  "--verify-isolated",
  "--measure-storage",
  "--editor-manage-restricted",
  "--conversion-strategy=strict",
  "--conversion-strategy=archived-static",
  "--conversion-strategy=archived-functional",
  "--concurrency=1",
  "--concurrency=2",
];
if (flags.some((f) => !allowed.includes(f)))
  throw new Error("Unknown import flag");
for (const prefix of ["--conversion-strategy=", "--concurrency="])
  if (flags.filter((f) => f.startsWith(prefix)).length > 1)
    throw new Error("Choose one " + prefix);
const apply = flags.includes("--apply-isolated");
const verifyOnly = flags.includes("--verify-isolated");
if (apply && verifyOnly) throw new Error("Choose apply or verify-only");
const databaseUrl = process.env.MIGRATION_DESTINATION_DATABASE_URL;
if (
  (apply || verifyOnly) &&
  (!databaseUrl || !process.env.MIGRATION_PUBLIC_ORIGIN)
)
  throw new Error(
    "Explicit MIGRATION_DESTINATION_DATABASE_URL and MIGRATION_PUBLIC_ORIGIN required",
  );
const mediaPlan = process.env.MIGRATION_MEDIA_PLAN;
const mediaReceipts = process.env.MIGRATION_MEDIA_RECEIPTS;
if (Boolean(mediaPlan) !== Boolean(mediaReceipts))
  throw new Error("Media plan and receipts must be supplied together");
const datasetReceipts = process.env.MIGRATION_DATASET_RECEIPTS;
const relationDirectory = process.env.MIGRATION_RELATION_SOURCE_DIRECTORY;
if (Boolean(datasetReceipts) !== Boolean(relationDirectory))
  throw new Error(
    "Dataset receipts and supplemental relation source must be supplied together",
  );
const supplementalReceipts = process.env.MIGRATION_SUPPLEMENTAL_ASSET_RECEIPTS;
const supplementalObjects = process.env.MIGRATION_SUPPLEMENTAL_ASSET_DIRECTORY;
if (Boolean(supplementalReceipts) !== Boolean(supplementalObjects))
  throw Error(
    "Supplemental asset receipts and flat object directory must be supplied together",
  );
const fontBundleDirectory = process.env.MIGRATION_FONT_BUNDLE_DIRECTORY;
const fontBundleManifestSha256 =
  process.env.MIGRATION_FONT_BUNDLE_MANIFEST_SHA256;
if (Boolean(fontBundleDirectory) !== Boolean(fontBundleManifestSha256))
  throw Error(
    "Font bundle directory and manifest digest must be supplied together",
  );
const options: MigrationJobOptions = {
  fontBundle:
    fontBundleDirectory && fontBundleManifestSha256
      ? {
          directory: fontBundleDirectory,
          manifestSha256: fontBundleManifestSha256,
        }
      : undefined,
  supplementalAssets:
    supplementalReceipts && supplementalObjects
      ? {
          receiptsPath: supplementalReceipts,
          objectsDirectory: supplementalObjects,
        }
      : undefined,
  sourceDirectory,
  datasets:
    datasetReceipts && relationDirectory
      ? { receiptsPath: datasetReceipts, relationDirectory }
      : undefined,
  indexDirectory,
  schema,
  reportPath,
  apply,
  verifyOnly,
  measureStorage: flags.includes("--measure-storage"),
  concurrency: flags.includes("--concurrency=2") ? 2 : 1,
  origin: process.env.MIGRATION_PUBLIC_ORIGIN ?? "http://localhost:8787",
  legacyOrigins: (process.env.MIGRATION_LEGACY_ORIGINS ?? "")
    .split(",")
    .filter(Boolean),
  editorManageRestricted: flags.includes("--editor-manage-restricted"),
  conversionStrategy: flags.includes(
    "--conversion-strategy=archived-functional",
  )
    ? "archived-functional"
    : flags.includes("--conversion-strategy=archived-static")
      ? "archived-static"
      : "strict",
  archivedRoot: process.env.MIGRATION_ARCHIVED_ROOT,
  conversionCacheDirectory: process.env.MIGRATION_CONVERSION_CACHE,
  media:
    mediaPlan && mediaReceipts
      ? {
          planPath: mediaPlan,
          receiptsPath: mediaReceipts,
          stagingDirectory: process.env.MIGRATION_MEDIA_STAGING_DIRECTORY,
        }
      : undefined,
};
const ports: MigrationJobPorts = {
  connectDestination:
    apply || verifyOnly
      ? async () => {
          const require = createRequire(import.meta.url);
          const { Client } = require("pg");
          const db = new Client({ connectionString: databaseUrl });
          try {
            await db.connect();
          } catch (error) {
            await db.end();
            throw error;
          }
          return { db, close: () => db.end() };
        }
      : undefined,
};
const summary = await runMigrationJob(options, ports);
process.stdout.write(JSON.stringify(summary) + "\n");
