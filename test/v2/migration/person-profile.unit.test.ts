import { test } from "node:test";
import assert from "node:assert/strict";
import { archivedPersonProfileSource } from "../../../src/migration/conversion/compiled/person-profile.ts";
test("archived person links use trusted core origin and refuse unknown kit shapes", () => {
  const source = "const link=<a href={`/@${card()?.handle}`}/>;";
  const output = archivedPersonProfileSource({
    source,
    coreUrl: "https://platform.example/af/v1/core.js",
  });
  assert.match(output, /https:\/\/platform.example/);
  assert.doesNotMatch(output, /location|baseURI/);
  assert.match(output, /encodeURIComponent/);
  assert.throws(() =>
    archivedPersonProfileSource({
      source: "different",
      coreUrl: "/af/v1/core.js",
    }),
  );
  const relative = archivedPersonProfileSource({
    source,
    coreUrl: "/af/v1/core.js",
  });
  assert.match(relative, /data-af-server/);
  assert.doesNotMatch(relative, /location|baseURI/);
});
test("relative core uses absolute downloaded metadata and unknown origin disables profile links", async () => {
  const { compiledPersonProfileHref } = await import(
    "../../../src/migration/conversion/compiled/person-profile.ts"
  );
  assert.equal(
    compiledPersonProfileHref("alice", "/af/v1/core.js", {
      src: "https://platform.example/af/v1/core.js",
    }),
    "https://platform.example/@alice",
  );
  assert.equal(
    compiledPersonProfileHref("_alice__", "/af/v1/core.js", {
      server: "https://platform.example",
    }),
    "https://platform.example/@_alice__",
  );
  for (const core of [
    undefined,
    {},
    { src: "/af/v1/core.js" },
    { server: "javascript:alert(1)" },
    { server: "https://external.example@platform.example" },
  ])
    assert.equal(
      compiledPersonProfileHref("alice", "/af/v1/core.js", core),
      undefined,
    );
  assert.equal(
    compiledPersonProfileHref(
      "alice",
      "https://platform.example/af/v1/core.js",
      { server: "https://runner.example" },
    ),
    "https://platform.example/@alice",
  );
});
