/**
 * File IDs and addresses (owner: brief B). Implementation: src/ids/file-id.ts (pure).
 *
 * A file ID is six characters from FILE_ID_ALPHABET, drawn with rejection
 * sampling: each random byte b is used only if b < 248 (248 = 62 * 4), as
 * FILE_ID_ALPHABET[b % 62]; other bytes are discarded. The same ID is the
 * API handle (/api/files/<id>/…) and the address.
 *
 * A page has three address forms on its server, all with the same behavior
 * (hosted view, `?download=1`, sign-in redirect for a private page a
 * signed-out visitor opens, 404 for anything unknown or unreadable):
 *   `${origin}/a/<id>`                 the canonical address, as published;
 *                                      `-<anything>` after the ID (a title slug) is ignored
 *   `${origin}/@<handle>/<path>`       the page at <path> in the library of the account
 *                                      whose handle is <handle> (src/server/handles-contracts.ts);
 *                                      an account without a handle has no such address, and a
 *                                      renamed or missing path or a freed handle is 404
 *   `${origin}/af/v1/ids/<id>`         any file by ID; a backend file's only address
 */
import type { FileId } from "../af-contracts.ts";

export type FileKind = "page" | "backend";

/** What a request path names: a file by ID, or a page by its owner's library path. */
export type PageAddress =
  | { kind: "id"; id: FileId }
  | { kind: "path"; handle: string; path: string };

/** Shape of src/ids/file-id.ts. */
export interface FileIdModule {
  /** `randomBytes(n)` must return n uniformly random bytes; it is called until six are accepted. */
  generateFileId(randomBytes: (count: number) => Uint8Array): FileId;
  isFileId(value: unknown): value is FileId;
  /** `${origin}/a/${id}`; throws on an invalid ID or an origin with a path. */
  fileAddress(origin: string, id: FileId): string;
  /**
   * The ID in a backend link address `<scheme>://<host>/af/v1/ids/<id>` on
   * any host, or null for anything else (extra path segments, query, invalid ID).
   */
  parseFileAddress(href: string): FileId | null;
  /**
   * The page a request path names: `/a/<id>` or `/a/<id>-<anything>`
   * (`{ kind: "id" }`), or `/@<handle>/<path>` with both percent-decoded
   * (`{ kind: "path" }`, `path` starting with "/"). Null for anything else:
   * `/af/v1/ids/…`, an invalid ID, a slug with a further segment, a missing
   * path, an empty, `.` or `..` segment, or undecodable escapes.
   */
  parseAddressPath(pathname: string): PageAddress | null;
}

/** Durable reservation of IDs for one account (src/server/af-ids.ts, Postgres). */
export interface IdReservationStore {
  /**
   * Reserve `count` (1..100) new IDs for `owner`. The same owner and key
   * return the same IDs; the same key with a different count fails with 422.
   */
  reserve(owner: string, idempotencyKey: string, count: number): Promise<{
    ids: FileId[];
    replayed: boolean;
  }>;
  /** Reserved by this owner and not yet used by a published file. */
  available(owner: string, id: FileId): Promise<boolean>;
}
