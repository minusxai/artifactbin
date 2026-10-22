import test from "node:test";
import assert from "node:assert/strict";
import {
  mediaDependencies,
  resolveMigrationReadiness,
} from "../src/migration/dependencies.ts";
test("asset dependencies inspect actual URL attributes and propagate absent/blocked targets without granting access", () => {
  assert.deepEqual(
    mediaDependencies(
      "<p>/af/v1/ids/ignore/assets/1/original/" +
        "a".repeat(64) +
        '</p><img src="https://example.test/af/v1/ids/target/assets/2/original/' +
        "b".repeat(64) +
        '">',
      "self00",
    ),
    ["/af/v1/ids/target/assets/2/original/" + "b".repeat(64)],
  );
  const result = resolveMigrationReadiness([
    { pageId: "first1", ready: true, dependencies: ["second"] },
    { pageId: "second", ready: true, dependencies: ["absent"] },
    { pageId: "cycle1", ready: true, dependencies: ["cycle2"] },
    { pageId: "cycle2", ready: true, dependencies: ["cycle1"] },
    { pageId: "block1", ready: false, dependencies: [] },
  ]);
  assert.deepEqual(result.ready, ["cycle1", "cycle2"]);
  assert.deepEqual(result.blocked.first1, ["second"]);
  assert.deepEqual(result.blocked.second, ["absent"]);
});
