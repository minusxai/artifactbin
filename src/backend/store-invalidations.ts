import type { RecordBackendStoreInvalidation } from "./store-invalidation-contracts.ts";
/** Serialize allocation until commit: a cursor must never skip a lower sequence
 * allocated by a transaction that commits after a higher visible sequence. */
export const recordBackendStoreInvalidation: RecordBackendStoreInvalidation =
  async (client, event, now = Date.now()) => {
    if (
      !event.backendId ||
      !Number.isSafeInteger(event.storeVersion) ||
      event.storeVersion < 1
    )
      throw new TypeError("Invalid store revision");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':backend-store-invalidation-sequence',0))",
    );
    await client.query(
      "INSERT INTO backend_store_invalidations(backend_id,store_version,created_at) VALUES($1,$2,$3)",
      [event.backendId, event.storeVersion, now],
    );
  };
