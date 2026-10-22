import { join } from "node:path";
import type {
  MigrationTestRequirement,
  RequiredMigrationInputs,
} from "./contracts.ts";
const flags: readonly MigrationTestRequirement[] = [
  "archived-compiler",
  "migration-database",
];
/** Explicit capability declarations stay beside tests. Environment-dependent tests cannot silently omit their release requirement. */
export function migrationTestRequirements(
  source: string,
): MigrationTestRequirement[] {
  if (/process\.env\.MIGRATION_LEGACY_ROOT\b/.test(source))
    throw Error(
      "Use PAGEGI_ARCHIVED_COMPILER_ROOT and declare // @requires archived-compiler",
    );
  const declared = [
    ...source.matchAll(/^\s*\/\/\s*@requires\s+(\S+)\s*$/gm),
  ].map((match) => match[1]!);
  if (
    declared.some((flag) => !flags.includes(flag as MigrationTestRequirement))
  )
    throw Error("Unknown test requirement");
  for (const [variable, flag] of [
    ["PAGEGI_ARCHIVED_COMPILER_ROOT", "archived-compiler"],
    ["MIGRATION_TEST_DATABASE_URL", "migration-database"],
  ] as const) {
    if (
      new RegExp("process\\.env\\." + variable + "\\b").test(source) &&
      !declared.includes(flag)
    )
      throw Error(`Declare // @requires ${flag} for this migration test`);
  }
  return [...new Set(declared)] as MigrationTestRequirement[];
}
export function requiredMigrationInputs(
  env: Readonly<Record<string, string | undefined>>,
  exists: (path: string) => boolean,
): RequiredMigrationInputs {
  const archivedRoot = env.PAGEGI_ARCHIVED_COMPILER_ROOT;
  if (!archivedRoot?.trim())
    throw Error(
      "Required migration verification needs PAGEGI_ARCHIVED_COMPILER_ROOT pointing to the frozen legacy checkout",
    );
  const databaseUrl = env.MIGRATION_TEST_DATABASE_URL;
  if (!databaseUrl?.trim())
    throw Error(
      "Required migration verification needs MIGRATION_TEST_DATABASE_URL pointing to disposable PostgreSQL",
    );
  for (const relative of [
    "services/app/lib/compiled-page/compiler.ts",
    "services/app/lib/author-script/author-module.server.ts",
    "services/app/public/islands/manifest.json",
    "node_modules/solid-js/package.json",
    "node_modules/esbuild/lib/main.js",
  ]) {
    if (!exists(join(archivedRoot, relative)))
      throw Error(`Incomplete frozen compiler checkout: missing ${relative}`);
  }
  return { archivedRoot, databaseUrl };
}
