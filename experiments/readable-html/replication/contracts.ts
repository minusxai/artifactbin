/** JSON-only values; each accepted operation advances the entire document version. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Operation {
  id: string; epoch: number; schema: 1; baseVersion: number;
  key: string; value: Json; expiresAt: number;
}
export type Rejection = 'conflict' | 'forbidden' | 'expired' | 'epoch' | 'schema' | 'invalid' | 'capacity' | 'id-reused';
export interface Receipt { id: string; binding: string; status: 'accepted' | 'rejected'; reason?: Rejection; version: number; }
export interface Snapshot { epoch: number; version: number; data: Record<string, Json>; }
export interface Server extends Snapshot { receipts: Record<string, Receipt>; effects: { id: string; epoch: number; version: number }[]; }
export interface Principal { canWrite: boolean; }
/** A trusted host callback rechecks authority inside the serialized commit. */
export type Authority = Principal | (() => Principal);
export type Clock = number | (() => number);
export interface Replica { confirmed: Snapshot; pending: Operation[]; dispatched: string[]; receipts: Receipt[]; }
export interface Limits { receipts: number; pending: number; bytes: number; effects: number; }
export const limits: Limits = { receipts: 1000, pending: 64, bytes: 65536, effects: 1000 };
export interface CommitResult { server: Server; receipt: Receipt; }
export interface DurableStore {
  load(): Promise<Server>;
  /** One exclusive writer owns this directory. All receipt/data/effect writes are atomic together. */
  commit(operation: Operation, principal: Authority, now: Clock): Promise<CommitResult>;
}
