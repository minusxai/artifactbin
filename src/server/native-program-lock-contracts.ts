/** Connections reserved for fresh authority reads and ordinary application requests. */
export const NATIVE_PROGRAM_SQL_RESERVED_CONNECTIONS = 6;
/** No waiting queue: rejection happens before acquiring an application SQL connection. */
export interface NativeProgramCapacityFailure extends Error {
  readonly code: "native_program_capacity";
  readonly retryable: true;
}
/** A cancellation retains admission until transaction and invocation cleanup settle. */
export interface NativeProgramSqlBudget {
  readonly poolCapacity: number;
  readonly reservedConnections: number;
  readonly lockHolders: number;
}
