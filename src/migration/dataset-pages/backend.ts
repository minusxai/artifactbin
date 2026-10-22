/** Dedicated read-only registration. Binding authority is provided by the importer,
 * then checked afresh by caps.dataset.read for every requested window. */
export const standaloneDatasetBackendSource = `export const typeDefs = \`
scalar DatasetRows
type DatasetColumn { name: String! type: String! }
type DatasetWindow { version: Int! generation: Int! schema: String! table: String! columns: [DatasetColumn!]! rows: DatasetRows! offset: Int! nextOffset: Int totalRows: Int! }
type Query { read(binding: String!, schema: String!, table: String!, offset: Int!, limit: Int!, expectedVersion: Int, expectedGeneration: Int): DatasetWindow! }
\`;
export default { Query: { read: (args, _principal, caps) => caps.dataset.read(args) } };
`;
