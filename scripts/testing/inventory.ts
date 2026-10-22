import { migrationTestRequirements } from "./migration-requirements.ts";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  TestCapability,
  TestDescriptor,
  TestRequirements,
  TestStage,
} from "./contracts.ts";
const capabilities: readonly TestCapability[] = [
  "unit",
  "local",
  "database",
  "browser",
  "isolate",
];
function requirements(capability: TestCapability): TestRequirements {
  return {
    build: capability !== "unit",
    postgres: ["database", "browser", "isolate"].includes(capability),
    // Isolate tests drive a hosted page's backend calls in Chromium.
    browsers:
      capability === "browser"
        ? ["chromium", "firefox", "webkit"]
        : capability === "isolate"
          ? ["chromium"]
          : [],
    backend: capability === "isolate",
  };
}
/** Classify declared execution capabilities, never infer requirements from imports or feature names. */
export function classifyTests(files: readonly string[]): TestDescriptor[] {
  const seen = new Set<string>();
  return files
    .filter((file) => /\.test\.(js|ts)$/.test(file))
    .sort()
    .map((file) => {
      if (seen.has(file)) throw Error(`Duplicate test: ${file}`);
      seen.add(file);
      const capability =
        /\.(unit|local|database|browser|isolate)\.test\.(js|ts)$/.exec(
          file,
        )?.[1] as TestCapability | undefined;
      if (!capability)
        throw Error(
          `Declare a test capability: ${file}. Use .unit, .local, .database, .browser, or .isolate before .test.`,
        );
      return { file, capability, requirements: requirements(capability) };
    });
}
/** v2 acceptance tests: part of every stage, and selectable on their own with `v2` stages. */
export const ACCEPTANCE_ROOT = "test/v2";
function listFiles(root: string, start: string): string[] {
  const files: string[] = [];
  function visit(relative: string): void {
    for (const entry of readdirSync(join(root, relative), {
      withFileTypes: true,
    })) {
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  visit(start);
  return files;
}
function describeTests(root: string, start: string): TestDescriptor[] {
  return classifyTests(listFiles(root, start)).map((test) => ({
    ...test,
    requirements: {
      ...test.requirements,
      migration: migrationTestRequirements(
        readFileSync(join(root, test.file), "utf8"),
      ),
    },
  }));
}
/** Recursively discover the complete Node test surface, including tests added in new module folders. */
export function discoverTests(root = process.cwd()): TestDescriptor[] {
  return describeTests(root, "test");
}
/** Discover only the v2 acceptance tests under test/v2. */
export function discoverAcceptanceTests(
  root = process.cwd(),
): TestDescriptor[] {
  return describeTests(root, ACCEPTANCE_ROOT);
}
/** `v2` selects every acceptance test; `v2:<capability>` selects one capability. */
export function selectAcceptanceTests(
  all: readonly TestDescriptor[],
  stage: string,
): TestDescriptor[] {
  if (stage === "v2") return [...all];
  const capability = /^v2:(\w+)$/.exec(stage)?.[1];
  if (!capability || !capabilities.includes(capability as TestCapability))
    throw Error(`Unknown test stage: ${stage}`);
  return all.filter((test) => test.capability === capability);
}
export function selectTests(
  all: readonly TestDescriptor[],
  stage: string,
): TestDescriptor[] {
  if (stage === "all") return [...all];
  if (stage === "required-migration")
    return all.filter((test) => test.requirements.migration?.length);
  if (stage === "integration")
    return all.filter((test) => test.capability !== "unit");
  if (!capabilities.includes(stage as TestCapability))
    throw Error(`Unknown test stage: ${stage}`);
  return all.filter((test) => test.capability === stage);
}
/** Setup is derived from actual selected files, including an unsharded full run. */
export function setupRequirements(
  tests: readonly TestDescriptor[],
): TestRequirements {
  const needs: TestRequirements = {
    build: false,
    postgres: false,
    browsers: [],
    backend: false,
  };
  for (const { requirements: r } of tests) {
    needs.build ||= r.build;
    needs.postgres ||= r.postgres;
    needs.backend ||= r.backend;
    for (const browser of r.browsers)
      if (!needs.browsers.includes(browser)) needs.browsers.push(browser);
  }
  return needs;
}
