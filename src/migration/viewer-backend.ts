/** Fixed viewer-capability source variant; legacy generated source bytes stay immutable. */
export function generatedViewerBackendSource(source: string): string {
  return source
    .replace(
      "type Query {",
      "type DatasetViewer { generation: String! id: String }\n type Query { viewer: DatasetViewer! ",
    )
    .replace(
      "Query: {",
      "Query: { viewer: (_args, _principal, caps) => caps.dataset.viewer(),",
    );
}
