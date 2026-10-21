import { test } from "node:test";
import assert from "node:assert/strict";
import { selectBrowserEngines } from "./browser-engines.js";

test("browser sharding keeps all three engines by default and selects each explicitly", () => {
  assert.deepEqual(Object.keys(selectBrowserEngines(undefined)), [
    "chromium",
    "firefox",
    "webkit",
  ]);
  for (const name of ["chromium", "firefox", "webkit"]) {
    const selected = selectBrowserEngines(name);
    assert.deepEqual(Object.keys(selected), [name]);
    assert.equal(selected[name].name(), name);
  }
});

test("invalid browser shard configuration fails rather than silently omitting coverage", () => {
  for (const value of [
    "",
    "safari",
    "Chromium",
    "chromium,firefox",
    "toString",
    "__proto__",
    " firefox ",
  ])
    assert.throws(() => selectBrowserEngines(value), /PAGEGI_TEST_ENGINE/);
});

test("shared-state journeys keep both placements by default and select each explicitly", async () => {
  const { selectSharedStateModes } = await import("./browser-engines.js");
  assert.deepEqual(selectSharedStateModes(undefined), ["preview", "hosted"]);
  for (const mode of ["preview", "hosted"])
    assert.deepEqual(selectSharedStateModes(mode), [mode]);
  for (const mode of ["", "other", "preview,hosted", "toString", "__proto__"])
    assert.throws(() => selectSharedStateModes(mode), /mode/);
});
