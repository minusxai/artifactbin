import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCodeQLCoverage,
  codeQLPartition,
  codeQLSuite,
} from "../scripts/ci/codeql-coverage.ts";
test("CodeQL query shards complement the complete installed standard suite", () => {
  assert.equal(codeQLPartition("a").filter, "exclude");
  assert.equal(codeQLPartition("b").filter, "exclude");
  for (const shard of ["a", "b", "c"] as const) {
    const suite = codeQLSuite(shard);
    assert.match(suite, /^- qlpack: codeql\/javascript-queries\n/);
    assert.match(suite, new RegExp(`- ${codeQLPartition(shard).filter}:`));
  }
  assert.throws(() => codeQLPartition("other"), /Unknown/);
  assertCodeQLCoverage({
    defaultQueries: ["old.ql", "new.ql", "diagnostic.ql"],
    shardA: ["old.ql"],
    shardB: ["diagnostic.ql"],
    shardC: ["new.ql"],
  });
});
test("coverage proof rejects missing, additional, duplicate, empty and overlapping query selections", () => {
  const complete = {
    defaultQueries: ["a.ql", "b.ql", "c.ql"],
    shardA: ["a.ql"],
    shardB: ["b.ql"],
    shardC: ["c.ql"],
  };
  for (const invalid of [
    { ...complete, shardB: [] },
    { ...complete, shardC: [] },
    { ...complete, shardC: ["a.ql"] },
    { ...complete, shardB: ["c.ql"] },
    { ...complete, shardA: ["a.ql", "a.ql"] },
    { ...complete, shardB: ["a.ql", "b.ql"] },
    { ...complete, defaultQueries: [] },
    { ...complete, defaultQueries: ["a.ql", "a.ql", "b.ql"] },
  ])
    assert.throws(() => assertCodeQLCoverage(invalid));
});

test("complementary exclusions assign existing and future rule ids exactly once", () => {
  const exclusions = ["a", "b", "c"].map((shard) => {
    const pattern = codeQLPartition(shard).pattern;
    return new RegExp(pattern.slice(1, -1));
  });
  for (const id of [
    "js/command-line-injection",
    "js/xss",
    "js/0-future-rule",
    "future/new-rule",
    "",
  ]) {
    assert.equal(
      exclusions.filter((pattern) => !pattern.test(id)).length,
      1,
      id,
    );
  }
});

test("three lanes balance the measured query families and retain future ids", () => {
  const assigned = (id: string) =>
    ["a", "b", "c"].filter((shard) => {
      const pattern = codeQLPartition(shard).pattern;
      return !new RegExp(pattern.slice(1, -1)).test(id);
    });
  assert.deepEqual(assigned("js/client-exposed-cookie"), ["a"]);
  assert.deepEqual(assigned("js/incomplete-hostname-regexp"), ["b"]);
  assert.deepEqual(assigned("js/xss"), ["c"]);
  assert.deepEqual(assigned("future/new-query"), ["c"]);
});
