/** Public routing metadata only; the saved backend registration fixes executing-page authority. */
export interface CompiledMembersBinding {
  backendNamespace: string;
  backendHref: string;
}
export interface CompiledMemberRow {
  user_id: string;
  joined_at: string;
}
export interface CompiledMembersSnapshot {
  generation: string;
  rows: readonly CompiledMemberRow[];
}
export interface CompiledMembersOptions {
  read(): Promise<unknown>;
  /** Undefined is a loading notification, null is an authorization/transport failure. */
  watch(listener: (snapshot: unknown) => void): () => void;
  /** Null invalidates all visible derived data before a replacement read is started. */
  changed(snapshot: CompiledMembersSnapshot | null): void;
}
export interface CompiledMembersAdapter {
  /** Failed reads are not cached: the next call starts a fresh request. */
  read(): Promise<CompiledMembersSnapshot>;
  refresh(): Promise<CompiledMembersSnapshot>;
  dispose(): void;
}
