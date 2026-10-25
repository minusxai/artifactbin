import type {NativeStoredRelationTimestamp} from "./relation-contracts";
/** Canonical persisted/source timestamp comparison preserves millisecond precision. */
export function nativeRelationTimestamp(value:NativeStoredRelationTimestamp):string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
