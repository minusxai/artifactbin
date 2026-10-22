import type { DatasetCallContext } from "./contracts.ts";
/** Accepted joins of the executing page only. ACL shares and owners are not joins. */
export interface DatasetMemberRow {
  user_id: string;
  joined_at: string;
}
export interface DatasetMembersSnapshot {
  /** Digest of current page authority and the exact ordered membership rows. */
  generation: string;
  rows: readonly DatasetMemberRow[];
}
export interface DatasetMembersPorts {
  snapshot(context: DatasetCallContext): Promise<DatasetMembersSnapshot | null>;
}
export interface DatasetMembersService {
  members(context: DatasetCallContext): Promise<DatasetMembersSnapshot>;
}
