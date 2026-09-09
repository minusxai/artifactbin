import type { Dataflow } from './dataflow';

/** Derived only from final stored source. Never contains viewer capabilities. */
export interface ParsedArtifactMetadataV1 {
  schemaVersion: 1;
  compilerRevision: string;
  sourceHash: string;
  flow: Dataflow;
  queryDependencies: Record<string, string[]>;
}

/** Pure final-source compilation; no queries, imports, or permissions. */
export function compileParsedArtifactMetadata(_source: string): ParsedArtifactMetadataV1 {
  throw new Error('M0: implement final-source metadata compilation');
}

/** Runtime-validates persisted metadata, falling back to canonical source. */
export function readParsedArtifactMetadata(_meta: unknown, _source: string): ParsedArtifactMetadataV1 {
  throw new Error('M0: implement validated metadata reader');
}
