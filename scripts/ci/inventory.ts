import { classifyTests, discoverTests, setupRequirements as testRequirements } from "../testing/inventory.ts";
import type { CheckInventory, CISetupRequirements } from "./contracts.ts";

/** Every discovered test file; CI shards partition exactly this list. */
export function inventory(): CheckInventory {
  return { testFiles: discoverTests().map((test) => test.file) };
}
function coordinates(shard: number, total: number) {
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(shard) || shard < 0 || shard >= total)
    throw Error("Invalid shard coordinates");
}
/**
 * Four shards keep setup apart: Postgres-only database tests, setup-free unit
 * and local tests, the Docker backend image for isolate tests, and the three
 * browser engines for browser tests. Other totals split the list evenly.
 */
export function selectTests(all: CheckInventory, shard: number, total: number): string[] {
  coordinates(shard, total);
  if (total === 1) return all.testFiles;
  if (total === 4) {
    const groups = { database: 0, unit: 1, local: 1, isolate: 2, browser: 3 } as const;
    return classifyTests(all.testFiles)
      .filter((test) => groups[test.capability] === shard)
      .map((test) => test.file);
  }
  return all.testFiles.filter((_, index) => index % total === shard);
}

export function setupRequirements(kind: string, shard: number, total: number, _engine = "chromium"): CISetupRequirements {
  if (kind === "validate") return { browsers: [], backend: false, postgres: false };
  coordinates(shard, total);
  if (kind !== "node") throw Error("Unknown CI setup kind");
  const selected = new Set(selectTests(inventory(), shard, total));
  const needs = testRequirements(discoverTests().filter((test) => selected.has(test.file)));
  return { browsers: needs.browsers, backend: needs.backend, postgres: needs.postgres };
}
