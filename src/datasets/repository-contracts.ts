import type { DatasetReadPorts } from "./contracts.ts";
/** Every call re-reads trusted current ACL, policy, identity and membership facts in a transaction. */
export type DatasetReadRepository = Pick<
  DatasetReadPorts,
  "binding" | "authority"
>;
