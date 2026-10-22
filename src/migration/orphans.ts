import { createHash } from "node:crypto";
import type { LegacyRow } from "./contracts.ts";
/** A missing referenced owner is not an orphan. Only the legacy empty-token sentinel is equivalent to NULL; undefined fields refuse. */
export function preservedOrphanActor(
  namespace: string,
  row: LegacyRow,
): string | null {
  if (
    !namespace ||
    typeof row.id !== "string" ||
    !row.id ||
    row.user_id !== null ||
    row.group_id !== null ||
    (row.token_id !== null && row.token_id !== "")
  )
    return null;
  return (
    "legacy-orphan:" +
    createHash("sha256")
      .update(JSON.stringify([namespace, row.id]))
      .digest("hex")
  );
}
