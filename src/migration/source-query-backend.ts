/** Separate fixed variant: existing dataset backend source identities remain unchanged. */
import { generatedDatasetBackendSource } from "./datasets/import-metadata.ts";
export const generatedSourceQueryBackendSource = generatedDatasetBackendSource
  .replace(
    "type Query {",
    "type Query { sourceQueryAvailability(name: String!): Boolean! sourceQuery(name: String!, valuesJson: String!, offset: Int!, limit: Int!, sortJson: String): String! ",
  )
  .replace(
    "Query: {",
    "Query: { sourceQueryAvailability: (args, _principal, caps) => caps.dataset.sourceQueryAvailability(args), sourceQuery: async (args, _principal, caps) => JSON.stringify(await caps.dataset.sourceQuery(args)),",
  );
