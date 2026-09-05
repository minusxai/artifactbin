/**
 * UNIMPLEMENTED CONTRACT DRAFT — planning only, excluded from production.
 * Stable, document-local identity for every renderable JSX element.
 *
 * This is deliberately a pure, deep module: it knows JSX source and identity
 * policy, but nothing about artifacts, annotations, transactions, or HTTP.
 * Write doors pass the previous source when one exists; the rollout/backfill
 * consumes the returned legacy aliases in the same transaction as its source
 * update.
 */

export const NODE_ID_LENGTH = 4;

export type NodeIdRepairReason = 'duplicate' | 'invalid-generated-id';

export interface NodeIdRepair {
  path: string;
  previousId: string;
  nextId: string;
  reason: NodeIdRepairReason;
}

export interface LegacyNodeIdAlias {
  /** The old data-annotation-anchor value stored by existing annotation rows. */
  legacyKey: string;
  /** The authored HTML id that remains authoritative for this node. */
  nodeId: string;
  path: string;
}

export interface StampNodeIdsOptions {
  /** The current stored source. Matching carries its ids into a replacement. */
  previousSource?: string | null;
  /** Deterministic seam for tests and backfill rehearsals. */
  mint?: () => string;
  /**
   * Backfill-only: remove a legacy anchor even when an authored id already
   * exists. The caller MUST migrate every returned alias transactionally.
   */
  retireLegacyAliases?: boolean;
}

export interface StampNodeIdsResult {
  source: string;
  eligibleCount: number;
  mintedCount: number;
  carriedCount: number;
  convertedLegacyCount: number;
  repairs: NodeIdRepair[];
  legacyAliases: LegacyNodeIdAlias[];
}

export interface NodeIdEntry {
  id: string;
  path: string;
  start: number;
  end: number;
  /** Old comment key retained only during the compatibility window. */
  legacyKey: string | null;
}

/** Stamp/carry ids and return rollout diagnostics. Never mutates either input. */
export function stampNodeIds(_source: string, _options: StampNodeIdsOptions = {}): StampNodeIdsResult {
  throw new Error('node-ids: implement');
}

/** Index current body elements by both node id and any compatibility alias. */
export function indexNodeIds(_source: string): Map<string, NodeIdEntry> {
  throw new Error('node-ids: implement');
}
