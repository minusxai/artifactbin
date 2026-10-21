import test from "node:test";
import assert from "node:assert/strict";
import { createCollaborationRepository } from "../src/persistence/collaboration.ts";
import type { CollaborationCatalog } from "../src/persistence/document-catalog-contracts.ts";
test("collaboration resolves follow-up profile and permalink reads through its injected catalog", async () => {
  const profiles = { viewer: { name: "Viewer", image: null } };
  const catalog: CollaborationCatalog = {
    async profiles(id, actors) {
      assert.equal(id, "document");
      assert.deepEqual(actors, ["viewer"]);
      return profiles;
    },
    async sharedLink(id) {
      assert.equal(id, "document");
      return "/d/aaaaaaaaaaaa";
    },
  };
  const repository = createCollaborationRepository(
    {
      async transaction() {
        throw Error("Catalog reads must use their own SQL owner");
      },
    },
    catalog,
  );
  assert.deepEqual(await repository.profiles("document", ["viewer"]), profiles);
  assert.equal(await repository.sharedLink("document"), "/d/aaaaaaaaaaaa");
});
