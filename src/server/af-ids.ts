import type { FileId } from "../af-contracts.ts";
import type {
  FileKind,
  RegisteredFileKind,
  IdReservationStore,
} from "../ids/file-id-contracts.ts";
import { generateFileId, isFileId } from "../ids/file-id.ts";
import { fail } from "../errors.ts";
import type { SqlClient, SqlDatabase } from "../persistence/sql.ts";

export type RandomBytes = (count: number) => Uint8Array;

/** The owner of a file ID and whether a file is published under it. */
export interface FileIdRecord {
  id: FileId;
  owner: string;
  kind: RegisteredFileKind | null;
  published: boolean;
}

/** Insert one fresh random ID; collisions and retired IDs are retried, never reused. */
export async function insertFreshId(
  client: SqlClient,
  randomBytes: RandomBytes,
  row: {
    owner: string;
    reservationKey: string | null;
    ordinal: number | null;
    kind: FileKind | null;
    now: number;
  },
): Promise<FileId> {
  for (let attempt = 0; attempt < 16; attempt++) {
    const id = generateFileId(randomBytes);
    const inserted = await client.query(
      // A deleted page's ID is retired (retired_file_ids) and never handed out again.
      "INSERT INTO file_ids(id,owner,reservation_key,ordinal,kind,published,created_at) SELECT $1::text,$2::text,$3::text,$4::integer,$5::text,$6::boolean,$7::bigint WHERE NOT EXISTS (SELECT 1 FROM retired_file_ids WHERE id=$1::text) ON CONFLICT (id) DO NOTHING RETURNING id",
      [
        id,
        row.owner,
        row.reservationKey,
        row.ordinal,
        row.kind,
        row.kind !== null,
        row.now,
      ],
    );
    if (inserted.rows.length) return id;
  }
  throw Error("Could not allocate a file ID");
}

export async function readFileId(
  client: SqlClient,
  id: string,
  lock = false,
): Promise<FileIdRecord | null> {
  if (!isFileId(id)) return null;
  const row = (
    await client.query(
      "SELECT id,owner,kind,published FROM file_ids WHERE id=$1" +
        (lock ? " FOR UPDATE" : ""),
      [id],
    )
  ).rows[0];
  return row
    ? {
        id: String(row.id),
        owner: String(row.owner),
        kind: (row.kind as RegisteredFileKind | null) ?? null,
        published: row.published === true,
      }
    : null;
}

/** Publish a reserved ID as `kind`; false when it is not this owner's unpublished reservation. */
export async function claimReservedId(
  client: SqlClient,
  owner: string,
  id: FileId,
  kind: FileKind,
): Promise<boolean> {
  return (
    (
      await client.query(
        "UPDATE file_ids SET kind=$3,published=true WHERE id=$1 AND owner=$2 AND published=false RETURNING id",
        [id, owner, kind],
      )
    ).rows.length > 0
  );
}

/** Durable per-account reservations behind POST /api/ids. */
export function createIdReservationStore(
  database: SqlDatabase,
  {
    randomBytes,
    now = Date.now,
  }: { randomBytes: RandomBytes; now?: () => number },
): IdReservationStore {
  return {
    reserve(owner, idempotencyKey, count) {
      if (!Number.isSafeInteger(count) || count < 1 || count > 100)
        fail(400, "count must be an integer from 1 to 100");
      if (
        typeof idempotencyKey !== "string" ||
        !idempotencyKey ||
        idempotencyKey.length > 200
      )
        fail(400, "Send an Idempotency-Key header");
      return database.transaction(async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':ids:' || $1 || ':' || $2,0))",
          [owner, idempotencyKey],
        );
        const existing = (
          await client.query(
            "SELECT id FROM file_ids WHERE owner=$1 AND reservation_key=$2 ORDER BY ordinal",
            [owner, idempotencyKey],
          )
        ).rows.map((row) => String(row.id));
        if (existing.length) {
          if (existing.length !== count)
            fail(422, "This Idempotency-Key was used with another count");
          return { ids: existing, replayed: true };
        }
        const ids: FileId[] = [];
        for (let ordinal = 0; ordinal < count; ordinal++)
          ids.push(
            await insertFreshId(client, randomBytes, {
              owner,
              reservationKey: idempotencyKey,
              ordinal,
              kind: null,
              now: now(),
            }),
          );
        return { ids, replayed: false };
      });
    },
    available(owner, id) {
      return database.transaction(async (client) => {
        const record = await readFileId(client, id);
        return !!record && record.owner === owner && !record.published;
      });
    },
  };
}
