import type { DockerCommand } from "./execution-contracts.ts";
/** True only after inspection definitively proves absence, including when another owner removed it concurrently. */
export type RemoveBackendContainer = (
  docker: DockerCommand,
  name: string,
) => Promise<boolean>;
