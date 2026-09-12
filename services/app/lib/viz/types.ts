/**
 * Viz V2 shared runtime contracts.
 *
 * The envelope schema itself lives in lib/validation/atlas-schemas.ts (VizEnvelope);
 * these are the runtime contracts for the validation / data-binding / theme pipeline.
 */

/** The reserved dataset name the query result is injected under. */
export const VIZ_DATASET_MAIN = 'main';

/** Inferred visualization kind for a query-result column (from its SQL type). */
export type VizColumnKind = 'quantitative' | 'temporal' | 'nominal' | 'boolean' | 'unknown';

export interface VizResultColumn {
  name: string;
  kind: VizColumnKind;
}

