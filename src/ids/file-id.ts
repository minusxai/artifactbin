/**
 * File IDs and addresses. Pure: randomness is injected.
 * See src/ids/file-id-contracts.ts for the rules.
 */
import {
  AF_IDS_PATH,
  AF_PAGE_PATH,
  AF_USER_PATH_PREFIX,
  FILE_ID_ALPHABET,
  FILE_ID_PATTERN,
  type FileId,
} from "../af-contracts.ts";
import type { PageAddress } from "./file-id-contracts.ts";

const LENGTH = 6;
/** 248 = 62 * 4: bytes at or above it would bias the alphabet. */
const LIMIT = FILE_ID_ALPHABET.length * 4;

export function generateFileId(
  randomBytes: (count: number) => Uint8Array,
): FileId {
  let id = "";
  while (id.length < LENGTH) {
    for (const byte of randomBytes(LENGTH - id.length))
      if (byte < LIMIT) id += FILE_ID_ALPHABET[byte % FILE_ID_ALPHABET.length];
  }
  return id;
}

export function isFileId(value: unknown): value is FileId {
  return typeof value === "string" && FILE_ID_PATTERN.test(value);
}

export function fileAddress(origin: string, id: FileId): string {
  if (!isFileId(id)) throw new TypeError("Invalid file ID");
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new TypeError("Invalid origin");
  }
  if (parsed.origin === "null" || parsed.origin !== origin)
    throw new TypeError("An origin has no path, query or trailing slash");
  return origin + AF_PAGE_PATH + id;
}

export function parseFileAddress(href: string): FileId | null {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.search || parsed.hash || href.includes("?") || href.includes("#"))
    return null;
  if (!parsed.pathname.startsWith(AF_IDS_PATH)) return null;
  const id = parsed.pathname.slice(AF_IDS_PATH.length);
  return isFileId(id) ? id : null;
}

function decodeSegment(segment: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return !decoded || decoded === "." || decoded === ".." || decoded.includes("/") ? null : decoded;
}

export function parseAddressPath(pathname: string): PageAddress | null {
  if (pathname.startsWith(AF_PAGE_PATH)) {
    const id = pathname.slice(AF_PAGE_PATH.length).split("-", 1)[0]!;
    const rest = pathname.slice(AF_PAGE_PATH.length + id.length);
    if (!isFileId(id) || (rest && !/^-[^/]*$/.test(rest))) return null;
    return { kind: "id", id };
  }
  if (!pathname.startsWith(AF_USER_PATH_PREFIX)) return null;
  const segments = pathname.slice(AF_USER_PATH_PREFIX.length).split("/").map(decodeSegment);
  if (segments.length < 2 || segments.some((segment) => segment === null)) return null;
  const [handle, ...path] = segments as string[];
  return { kind: "path", handle: handle!, path: "/" + path.join("/") };
}

export function legacyHandleAddressId(path: string): FileId | null {
  if (!path.startsWith("/") || path.indexOf("/", 1) !== -1) return null;
  const id = path.slice(1).split("-", 1)[0]!;
  const rest = path.slice(1 + id.length);
  return isFileId(id) && (rest === "" || rest.startsWith("-")) ? id : null;
}
