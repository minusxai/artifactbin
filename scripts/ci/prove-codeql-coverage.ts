import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { codeQLSuite, assertCodeQLCoverage } from "./codeql-coverage.ts";
const [codeql] = process.argv.slice(2);
if (!codeql || !process.env.RUNNER_TEMP)
  throw Error("Missing installed CodeQL or runner temp path");
const resolve = (suite: string): string[] => {
  const result: unknown = JSON.parse(
    execFileSync(codeql, ["resolve", "queries", "--format=json", "--", suite], {
      encoding: "utf8",
    }),
  );
  if (
    !Array.isArray(result) ||
    result.some((value) => typeof value !== "string")
  )
    throw Error("Invalid installed CodeQL query manifest");
  return result as string[];
};
const [a, b, c] = ["a", "b", "c"].map((shard) => {
  const path = join(process.env.RUNNER_TEMP!, `pagegi-codeql-${shard}.qls`);
  writeFileSync(path, codeQLSuite(shard));
  return resolve(path);
});
const coverage = {
  defaultQueries: resolve(
    "codeql/javascript-queries:codeql-suites/javascript-code-scanning.qls",
  ),
  shardA: a!,
  shardB: b!,
  shardC: c!,
};
console.log(
  `Resolved installed query manifests: standard=${coverage.defaultQueries.length}, a=${coverage.shardA.length}, b=${coverage.shardB.length}, c=${coverage.shardC.length}`,
);
assertCodeQLCoverage(coverage);
console.log(
  `CodeQL coverage proved: ${coverage.defaultQueries.length} installed standard queries = ${coverage.shardA.length} + ${coverage.shardB.length} + ${coverage.shardC.length}; no missing, additional, repeated or overlapping queries.`,
);
