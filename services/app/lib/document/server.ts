/**
 * THE STORED DOCUMENT's node-only half: a markup document's compiled-dataflow record, kept in
 * `meta.parsedArtifact` beside the source it was compiled from (node:crypto hashes the source, zod
 * checks the record). Recompiling a stale record needs the composition's SQL extensions, which the
 * caller passes (`readCompiledDataflow(..., { extensions })`). Browser code never imports this file.
 */
export { COMPILED_DATAFLOW, finalizeArtifactMetadata, parseCompiledDataflow, readCompiledDataflow, storedCompiledDataflow } from './parsed-artifact-metadata';
