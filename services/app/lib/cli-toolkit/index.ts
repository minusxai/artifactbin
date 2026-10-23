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
  canonicalizeMarkup, dataflowOf, declarationsOf, formatMarkupSource, nodeIndex, stampNodeIds, stampNodeIdsInPlace,
  validateMarkupStructure,
} from '../document';
export { assetFormatOf, fileContentType } from '@artifactbin/contracts';

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

// ---- Dataflow: compile and evaluate a document's queries locally.
export { compileWithLoader, validateVizAgainstColumns } from '../dataflow/server';
export { collectRefUses } from '../dataflow/references';
export { refName, selectQueries, type ImportTables, evaluateDataflow, type RunDataflowOptions, validateQueryValues, REFERENCE_POSITIONS, type CompiledDataflow, type Dataflow, type DataflowState, type DatasetColumn } from '../dataflow';

// ---- Data ingest: CSV and GeoJSON files as typed rows.
export { coerceRows } from '../data-ingest/coerce';
export { parseCsv } from '../data-ingest/csv';
export { geoJsonRows, rowsGeoJson } from '../data-ingest/geojson';

// ---- Designs and templates: the names validation and the teaching accept.
export { STORY_DESIGN_NAMES, STORY_TEMPLATE_NAMES } from '../validation/atlas-schemas';


// ---- Backend contract: the artifact backend's errors and answers, dataset definitions.
export { BackendRequestError } from '../artifact-backend/errors';
export { parseDatasetDefinition } from '../datasets/definition';
export type { CatalogInput, DatasetConnection } from '../datasets/types';

// ---- Team host configuration, parsed by the CLI before it starts the host.
export { parseDatabaseUrl } from '../platform/database-url';
