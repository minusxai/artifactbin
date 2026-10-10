/**
 * THE CLI'S CONTRACT WITH THE APP, PART 1: what the `afbin` process itself uses (dist/afbin.mjs).
 *
 * `services/cli/src` imports app code only through this module, `./host.server`, `./browser` and
 * `./browser-connect` (scripts/ci/module-graph.mjs, the CLI toolkit rule), so a move inside the app
 * breaks one re-export here, not a CLI file, and every name the CLI depends on is a reviewed line.
 *
 * One entry per CLI bundle, because a bundler carries every module an entry re-exports into each
 * bundle that imports it. This one is bundled into `afbin.mjs`, which
 * must stay small and self-contained: only the pure document model, dataflow, data ingest and the
 * local file format, plus the backend contract's types. Nothing here may reach the render pipeline,
 * server configuration or a native package (`./host.server` carries those); a value import from such
 * a module makes the CLI bundle fail to build or to start alone. Types from heavier modules are
 * `export type` lines, which every bundler erases.
 */

// ---- JSX engine: parse, serialize and repair document markup.
export { parseJsx, repairJsxSource, serializeJsx } from '../jsx';
export type { JsxElement, JsxNode } from '../jsx';

// ---- Document model: the head (Helmet), node ids, validation and canonical source.
export {
  assetFormatOf, canonicalizeMarkup, dataflowOf, declarationsOf, fileContentType, formatMarkupSource, nodeIndex, socialPreviewCrop, socialPreviewImage,
  splitHelmet, stampNodeIds, validateMarkupStructure,
} from '../document';

// ---- Edit algebra: the document graph, its patches, update preparation and rebasing.
export {
  applyGraphPatch, createDocumentGraph, documentAfterOperation, graphSource, prepareClientDocumentPublication, rebaseEditBatch, sourceChanges,
  sourcePathToBodyPath,
} from '../document';

// ---- Comments: anchors (annotation ranges), authorship and local file comments.
export { canonicalQuote, canonicalText, parseAnnotationRange } from '../document';
export type { AnnotationRange } from '../document';
export { annotationAuthorForAgent } from '../annotations/author';
export type { AnnotationWire } from '../annotations/store';
export type { AnnotationAuthor, AnnotationCommentWire } from '@artifactbin/contracts';
export { validateFileComments } from '../offline/comment-validation';

// ---- Dataflow: compile and evaluate a document's queries locally.
export { compileWithLoader } from '../dataflow/compile-dataflow';
export { selectQueries } from '../dataflow/compiled-flow';
export type { ImportTables } from '../dataflow/compiled-flow';
export { evaluateDataflow } from '../dataflow/evaluate';
export type { RunDataflowOptions } from '../dataflow/evaluate';
export { validateQueryValues } from '../dataflow/query-values';
export { collectRefUses } from '../dataflow/refs';
export { imageReferenceId } from '../dataflow/image-source';
export { REFERENCE_POSITIONS } from '../dataflow/reference-positions';
export type { CompiledDataflow } from '../dataflow/compiled-dataflow';
export type { Dataflow, DataflowState } from '../dataflow/dataflow';
export type { DatasetColumn } from '../dataflow/dataset-shape';
export type { RefDataMap } from '../dataflow/ref-data';

// ---- Data ingest: CSV and GeoJSON files as typed rows.
export { coerceRows } from '../data-ingest/coerce';
export { parseCsv } from '../data-ingest/csv';
export { geoJsonRows, rowsGeoJson } from '../data-ingest/geojson';

// ---- Designs and templates: the names validation and the teaching accept.
export { resolveStoredStoryDesign } from '../data/story/story-themes';
export { STORY_DESIGN_NAMES, STORY_TEMPLATE_NAMES } from '../validation/atlas-schemas';
export type { StoryDesignName } from '../validation/atlas-schemas';

// ---- Local artifact file format (the offline `.html` file).
export { sourceDigest } from '../offline/file-format';
export type { ArtifactFile } from '../offline/file-format';
export { readArtifactFileHtml } from '../offline/offer';

// ---- Backend contract: the artifact backend's errors and answers, dataset definitions.
export { BackendRequestError } from '../artifact-backend/errors';
export type { ArtifactVersionSnapshot, ArtifactVersionSummary, EditAnswer, LoadedArtifact } from '../artifact-backend/types';
export { parseDatasetDefinition } from '../datasets/definition';
export type { CatalogInput, DatasetConnection } from '../datasets/types';

// ---- Team host configuration, parsed by the CLI before it starts the host.
export { parseDatabaseUrl } from '../platform/database-url';
