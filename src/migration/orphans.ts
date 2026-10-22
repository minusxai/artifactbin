import { createHash } from "node:crypto";
import type { LegacyRow } from "./contracts.ts";
/** A missing referenced owner is not an orphan. Undefined/empty fields also refuse. */
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
    row.token_id !== null
  )
    return null;
  return (
    "legacy-orphan:" +
    createHash("sha256")
      .update(JSON.stringify([namespace, row.id]))
      .digest("hex")
  );
}
