import test from "node:test";
import assert from "node:assert/strict";
import { buildSchema, parse, validate } from "graphql";
import { compiledDatasetMutationDocument } from "../src/migration/conversion/compiled/dataset-mutations.ts";
import { composePageSchema } from "../src/graphql/af-namespaces.ts";
import { readBackendModule } from "../src/backend/af-module.ts";
import { generatedDatasetBackendSource } from "../src/migration/datasets/import-metadata.ts";
test("browser mutation document validates against the actual composed backend scalar namespace", async () => {
  const module = await readBackendModule(generatedDatasetBackendSource);
  for (const name of ["legacyData", "otherData"]) {
    const composed = composePageSchema([
      { name, fileId: "Back12", version: "v1", typeDefs: module.typeDefs },
    ]);
    assert.deepEqual(
      validate(
        buildSchema(composed.sdl),
        parse(compiledDatasetMutationDocument(name)),
      ),
      [],
    );
  }
});
