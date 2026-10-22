import test from "node:test";
import assert from "node:assert/strict";
import { projectMigrationProfiles } from "../src/migration/profiles.ts";
test("legacy public cards preserve display identity separately and never leak account or storage secrets", () => {
  const result = projectMigrationProfiles([
    {
      id: "one",
      name: "Display",
      username: "handle",
      email: "private@example.test",
      image_key: "private-object",
    },
    { id: "two", name: "", username: "second" },
    { id: "three", name: null, username: null },
  ]);
  assert.deepEqual(result, {
    profiles: [
      { legacyUserId: "one", name: "Display", handle: "handle", image: null },
      { legacyUserId: "two", name: "second", handle: "second", image: null },
      { legacyUserId: "three", name: "three", handle: null, image: null },
    ],
    unavailableAvatarImages: 1,
  });
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.throws(
    () => projectMigrationProfiles([{ id: "one" }, { id: "one" }]),
    /Ambiguous/,
  );
});

test("person selector publication refuses a column without its exact admitted binding before SQL", async () => {
  const { PostgresDatasetMetadataDestination } = await import(
    "../src/migration/dataset-destination.ts"
  );
  let queries = 0;
  const destination = new PostgresDatasetMetadataDestination(
    {
      query: async () => {
        queries++;
        return { rows: [] };
      },
    },
    "isolated",
  );
  await assert.rejects(
    destination.import({
      baseManifestSha256: "a".repeat(64),
      relationManifestSha256: "b".repeat(64),
      relationExportedAt: "2026-01-01T00:00:00Z",
      metadata: {
        sourceNamespace: "fixture",
        bindings: [],
        pages: [],
        resources: [],
        versions: [],
        principals: [],
        groups: [],
        acceptedJoins: [],
        personBindings: [
          {
            sourceNamespace: "fixture",
            backendId: "abc123",
            backendVersion: "v1",
            pageId: "def456",
            pageVersion: 1,
            valueName: "who",
            bindingName: "data",
            schema: "public",
            table: "rows",
            column: "private",
          },
        ],
      },
    }),
    /exact admitted user column/,
  );
  assert.equal(queries, 0);
});

test("verified avatars project only an opaque scoped asset identity", () => {
  const asset = {
    sourceNamespace: "fixture",
    legacyUserId: "one",
    assetId: "c".repeat(64),
    objectKey: "avatar/one/" + "a".repeat(32),
    kind: "avatar" as const,
    sha256: "a".repeat(64),
    storageKey: "a".repeat(64),
    byteLength: 20,
    width: 10,
    height: 5,
    contentType: "image/webp" as const,
  };
  const result = projectMigrationProfiles(
    [{ id: "one", image_key: asset.objectKey }],
    [asset],
  );
  assert.equal(result.profiles[0]!.image, asset.assetId);
  assert.equal(result.unavailableAvatarImages, 0);
  assert.equal(JSON.stringify(result).includes("avatar/"), false);
});
