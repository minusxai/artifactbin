import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyTests,
  selectAcceptanceTests,
  selectTests,
  setupRequirements,
} from "../scripts/testing/inventory.ts";
test("capability declarations discover new module tests without updating a list", () => {
  const files = [
    "test/new-feature.unit.test.ts",
    "test/nested/another.local.test.js",
    "test/store.database.test.ts",
    "test/view.browser.test.js",
    "test/backend.isolate.test.ts",
    "test/support.js",
    "test/fixtures/a.html",
  ];
  const all = classifyTests(files);
  assert.equal(all.length, 5);
  assert.deepEqual(
    selectTests(all, "unit").map((x) => x.file),
    [files[0]],
  );
  assert.equal(selectTests(all, "integration").length, 4);
  assert.deepEqual(selectTests(all, "all"), all);
  for (const descriptor of all)
    assert.equal(
      selectTests(all, descriptor.capability).filter(
        (x) => x.file === descriptor.file,
      ).length,
      1,
    );
});
test("unclassified tests, duplicate entries and unknown stages fail instead of disappearing", () => {
  for (const file of ["test/new.test.ts", "test/new.fast.test.js"])
    assert.throws(() => classifyTests([file]), /Declare.*capability/);
  assert.throws(
    () => classifyTests(["test/a.unit.test.ts", "test/a.unit.test.ts"]),
    /Duplicate/,
  );
  assert.throws(() => selectTests([], "typo"), /Unknown test stage/);
});
test("setup follows selected capabilities including browser database and complete one-shard execution", () => {
  const all = classifyTests([
    "test/model.unit.test.ts",
    "test/preview.local.test.js",
    "test/data.database.database.test.js",
    "test/library.browser.test.ts",
    "test/backend.isolate.test.ts",
  ]);
  assert.deepEqual(setupRequirements(selectTests(all, "unit")), {
    build: false,
    postgres: false,
    browsers: [],
    backend: false,
  });
  assert.deepEqual(setupRequirements(selectTests(all, "local")), {
    build: true,
    postgres: false,
    browsers: [],
    backend: false,
  });
  assert.deepEqual(setupRequirements(selectTests(all, "isolate")), {
    build: true,
    postgres: true,
    browsers: ["chromium"],
    backend: true,
  });
  const browser = setupRequirements(selectTests(all, "browser"));
  assert.equal(browser.postgres, true);
  assert.deepEqual(browser.browsers, ["chromium", "firefox", "webkit"]);
  assert.deepEqual(setupRequirements(all), {
    build: true,
    postgres: true,
    browsers: ["chromium", "firefox", "webkit"],
    backend: true,
  });
});

test("v2 acceptance stages select all acceptance tests or one capability", () => {
  const all = classifyTests([
    "test/v2/page/page-model.unit.test.ts",
    "test/v2/server/publish.database.test.ts",
    "test/v2/core/todo.browser.test.ts",
  ]);
  assert.equal(selectAcceptanceTests(all, "v2").length, 3);
  assert.deepEqual(
    selectAcceptanceTests(all, "v2:database").map((x) => x.file),
    ["test/v2/server/publish.database.test.ts"],
  );
  assert.throws(() => selectAcceptanceTests(all, "v2:typo"), /Unknown test stage/);
  assert.throws(() => selectAcceptanceTests(all, "unit"), /Unknown test stage/);
});
