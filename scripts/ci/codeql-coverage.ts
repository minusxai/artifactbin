import type { CodeQLPartition, CodeQLQueryCoverage } from "./contracts.ts";
// Measured overlapping query evaluation totals were approximately 111/130/140s.
// The final lane also retains future identifiers outside the current js prefix.
export function codeQLPartition(shard: string): CodeQLPartition {
  if (shard !== "a" && shard !== "b" && shard !== "c")
    throw Error("Unknown CodeQL query partition");
  const patterns = {
    a: String.raw`/^(?!js\/[a-g]).*/`,
    b: String.raw`/^(?!js\/[h-r]).*/`,
    c: String.raw`/js\/[a-r].*/`,
  };
  return { shard, filter: "exclude", pattern: patterns[shard] };
}
export function codeQLConfig(shard: string): string {
  if (shard === "full") return "name: Standard security analysis\n";
  const partition = codeQLPartition(shard);
  return `query-filters:\n  - ${partition.filter}:\n      id: ${partition.pattern}\n`;
}
export function codeQLSuite(shard: string): string {
  const partition = codeQLPartition(shard);
  return `- qlpack: codeql/javascript-queries\n- ${partition.filter}:\n    id: ${partition.pattern}\n`;
}
export function assertCodeQLCoverage(coverage: CodeQLQueryCoverage): void {
  for (const [name, queries] of Object.entries(coverage) as [
    string,
    string[],
  ][]) {
    if (
      !queries.length ||
      queries.some(
        (query) => typeof query !== "string" || !query.endsWith(".ql"),
      ) ||
      new Set(queries).size !== queries.length
    )
      throw Error(`Invalid or duplicate ${name} queries`);
  }
  const union = [
    ...coverage.shardA,
    ...coverage.shardB,
    ...coverage.shardC,
  ].sort();
  if (new Set(union).size !== union.length)
    throw Error("CodeQL query shards overlap");
  if (
    JSON.stringify(union) !==
    JSON.stringify([...coverage.defaultQueries].sort())
  )
    throw Error(
      "CodeQL query shards must preserve the complete installed default suite",
    );
}
