import type { CompiledBackend } from "./contracts.ts";
import type { DatasetCallContext } from "../datasets/contracts.ts";
/** Read-only compatibility for sealed migration backends that predate their viewer resolver. */
export interface LegacyViewerCompatibility {
  schema(
    input: Omit<DatasetCallContext, "subject"> & {
      deployment: CompiledBackend;
      typeDefs: string;
    },
    signal: AbortSignal,
  ): Promise<string | null>;
}
export interface LegacyViewerBindingPort {
  current(
    context: Omit<DatasetCallContext, "subject">,
    signal: AbortSignal,
  ): Promise<boolean>;
}
