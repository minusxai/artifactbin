import { fail } from "../errors.ts";
import type { FileRoute, RequestBody } from "./request-contracts.ts";

/** Classify client syntax errors without exposing JSON parser diagnostics. */
export function parseRequestBody(raw: string): RequestBody {
  if (!raw) return {};
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    fail(400, "Invalid JSON request body");
  }
  if (input === null || typeof input !== "object" || Array.isArray(input))
    fail(400, "JSON request body must be an object");
  return input as RequestBody;
}

/** Path grammar is exact: repeated separators and extra segments never alias an endpoint. */
export function parseFileRoute(pathname: string): FileRoute | null {
  // File routes take six-character file IDs only (src/af-contracts.ts).
  const match = /^\/api\/files\/([A-Za-z0-9]{6})\/(.+)$/.exec(pathname);
  if (!match) return null;
  const tail = match[2]!;
  if (
    !/^(?:source|comments|capture|permissions|sharing|profiles|presence|revoke|sync|comments\/[^/]+|context\/[^/]+|sync\/checkpoint|sync\/intents\/ack|backends|graphql)$/.test(
      tail,
    )
  )
    return null;
  return { fileId: match[1]!, parts: pathname.split("/").slice(1) };
}
