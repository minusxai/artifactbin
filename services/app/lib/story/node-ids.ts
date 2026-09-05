/** Source identity policy only; storage reserves emitted ids in its write transaction. */
import type { JsxElement } from '@/lib/jsx';

export interface NodeIdEntry { id: string; path: string; node: JsxElement; legacyKey: string | null }
export interface NodeIdRepair { path: string; from: string | null; to: string; reason: 'duplicate' | 'invalid' }
export interface NodeIdAlias { legacyKey: string; nodeId: string; path: string }
export interface NodeIdOptions {
  previousSource?: string | null;
  /** Lifetime ledger, not just the current head. Only fresh generation excludes these. */
  reservedIds?: Iterable<string>;
  /** Defaults to cryptographic letter-first, four-character ids. */
  mint?: () => string;
  /** Removing conflicting legacy attributes requires atomic relation migration by caller. */
  retireLegacyAliases?: boolean;
}
export interface NodeIdResult {
  source: string;
  ids: string[];
  minted: number;
  carried: number;
  repairs: NodeIdRepair[];
  aliases: NodeIdAlias[];
}
/** Preserve explicit ids. Recover only unambiguous exact-content matches without ids. */
export function stampNodeIds(_source: string, _options: NodeIdOptions = {}): NodeIdResult {
  throw new Error('node-ids: implement');
}
/** Source-node index; real ids only, first occurrence wins on legacy malformed documents. */
export function nodeIndex(_source: string): Map<string, NodeIdEntry> {
  throw new Error('node-ids: implement');
}
