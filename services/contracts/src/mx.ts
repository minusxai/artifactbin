import type { ColumnType, DatasetColumn, Scalar } from './sql';

/** Public artifact data API, shared by the document and its managed author iframe. */
export interface MxError { code: string; message: string }
export interface MxTable { columns: DatasetColumn[]; rows: Record<string, unknown>[]; truncated?: boolean }
export interface MxSignal {
  value: Scalar | MxTable;
  status: 'ready' | 'pending' | 'error';
  error?: MxError;
}
export interface MxRevision { instanceEpoch: string; revision: number }
export interface MxSnapshot extends MxRevision { signals: Record<string, MxSignal> }
export interface MxDescription {
  instanceEpoch: string;
  /** `url: false` — the document keeps this signal out of its address (`<Value url={false}>`); absent means it travels in the link. */
  signals: Array<{ name: string; kind: 'scalar' | 'table' | 'query'; writable: boolean; type?: ColumnType; columns?: DatasetColumn[]; url?: false }>;
  /** `reset` — the scalar signals this mutation returns to their defaults once it commits (`<Mutation reset="…">`). */
  mutations: Array<{ name: string; scope: 'local' | 'dataset'; args: string[]; available: boolean; unavailableReason: string | null; reset?: string[] }>;
}
export interface MxReadOptions { wait?: boolean; refresh?: boolean; timeoutMs?: number }
export interface MxMutationReceipt { operationId: string; scope: 'local' | 'dataset'; status: 'committed' }
export type MxMutationArgs = Record<string, Scalar | Record<string, Scalar>>;
export interface MxApi {
  describe(): Promise<MxDescription>;
  read(names: string[], options?: MxReadOptions): Promise<MxSnapshot>;
  set(values: Record<string, Scalar>): Promise<MxRevision>;
  mutate(name: string, args?: MxMutationArgs): Promise<MxMutationReceipt>;
  /** Initial snapshot is asynchronous. The returned stop function is synchronous and idempotent. */
  subscribe(names: string[], callback: (snapshot: MxSnapshot) => void): () => void;
}
