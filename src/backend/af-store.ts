/**
 * `caps.store` (BackendStore in af-backend-contracts.ts): each backend file's
 * one JSON document, kept in `af_backend_stores` by the platform. Resolvers
 * reach it only through a capability handler the server builds per call, so
 * the isolate never touches the database; the handler names the file, never
 * the request.
 */
import {
  BACKEND_STORE_LIMIT_BYTES,
  type BackendStore,
  type SqlDatabase,
} from "./af-backend-contracts.ts";
import {
  BackendStoreLimitError,
  type BackendCapabilityHandler,
  type BackendJson,
  type BackendStoreDocument,
  type BackendStoreWrite,
} from "./contracts.ts";

import { recordBackendStoreInvalidation } from "./store-invalidations.ts";

function storable(value: BackendJson): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new TypeError("The store holds JSON only");
  }
  if (text === undefined) throw new TypeError("The store holds JSON only");
  if (Buffer.byteLength(text) > BACKEND_STORE_LIMIT_BYTES)
    throw new BackendStoreLimitError();
  return text;
}

function version(expected: unknown): number {
  if (
    typeof expected !== "number" ||
    !Number.isSafeInteger(expected) ||
    expected < 0
  )
    throw new TypeError(
      "expected must be the version you read (0 when the store is empty)",
    );
  return expected;
}

export function createBackendStore(database: SqlDatabase): BackendStore {
  async function get(fileId: string): Promise<BackendStoreDocument> {
    return database.transaction(async (client) => {
      const row = (
        await client.query(
          "SELECT value, version FROM af_backend_stores WHERE file_id = $1",
          [fileId],
        )
      ).rows[0];
      return row
        ? { value: row.value as BackendJson, version: Number(row.version) }
        : { value: null, version: 0 };
    });
  }
  async function set(
    fileId: string,
    value: BackendJson,
    expected: number,
  ): Promise<BackendStoreWrite> {
    const text = storable(value);
    const from = version(expected);
    return database.transaction(async (client) => {
      const written =
        from === 0
          ? await client.query(
              `INSERT INTO af_backend_stores (file_id, version, value) VALUES ($1, 1, $2::jsonb)
               ON CONFLICT (file_id) DO NOTHING RETURNING version`,
              [fileId, text],
            )
          : await client.query(
              `UPDATE af_backend_stores SET value = $2::jsonb, version = version + 1, updated_at = now()
               WHERE file_id = $1 AND version = $3 RETURNING version`,
              [fileId, text, from],
            );
      if (written.rows[0]) {
        const next = Number(written.rows[0].version);
        await recordBackendStoreInvalidation(client, {
          backendId: fileId,
          storeVersion: next,
        });
        return { version: next };
      }
      const current = (
        await client.query(
          "SELECT version FROM af_backend_stores WHERE file_id = $1",
          [fileId],
        )
      ).rows[0];
      return { conflict: true, version: current ? Number(current.version) : 0 };
    });
  }
  return {
    get,
    set,
    handler(fileId): BackendCapabilityHandler {
      return async (_principal, request) => {
        if (request.kind !== "store")
          throw new Error("No resources are connected to this backend");
        if (request.operation === "get")
          return { ...(await get(fileId)) } as unknown as BackendJson;
        if (request.operation === "set")
          return {
            ...(await set(fileId, request.value, request.expected)),
          } as unknown as BackendJson;
        throw new TypeError("Unknown store operation");
      };
    },
  };
}
