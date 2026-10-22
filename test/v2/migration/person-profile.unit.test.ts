import { test } from "node:test";
import assert from "node:assert/strict";
import { archivedPersonProfileSource } from "../../../src/migration/conversion/compiled/person-profile.ts";
test("archived person links use trusted core origin and refuse unknown kit shapes", () => {
  const source = "const link=<a href={`/@${card()?.handle}`}/>;";
  const output = archivedPersonProfileSource({
    source,
    coreUrl: "https://platform.example/af/v1/core.js",
  });
  assert.match(output, /"https:\/\/platform.example"/);
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
