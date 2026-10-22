import { externalCompile } from "./index.ts";
import { MAX_COMPILED_SOURCE_BYTES } from "./contracts.ts";
import type { LegacyDocumentSourceRecovery } from "../document-recovery-contracts.ts";
export async function recoverArchivedDocumentSource(
  document: unknown,
  legacyRoot: string,
): Promise<LegacyDocumentSourceRecovery | null> {
  try {
    const result = await externalCompile<
      LegacyDocumentSourceRecovery,
      { document: unknown }
    >({ document }, { legacyRoot }, "document-recovery-runner.mts");
    return result &&
      typeof result.source === "string" &&
      Buffer.byteLength(result.source) <= MAX_COMPILED_SOURCE_BYTES &&
      Number.isSafeInteger(result.repairedNodes) &&
      result.repairedNodes > 0
      ? result
      : null;
  } catch {
    return null;
  }
}
