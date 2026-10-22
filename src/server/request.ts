import { fail } from "../errors.ts";
import type { FileRoute, RequestBody } from "./request-contracts.ts";
import {MAX_REQUEST_BODY_BYTES} from '../af-contracts.ts';
import {StringDecoder} from 'node:string_decoder';
/** Bound incoming wire bytes before decoding, preserving split UTF-8 scalars. */
export async function readRequestText(chunks:AsyncIterable<Uint8Array>,limit=MAX_REQUEST_BODY_BYTES):Promise<string>{
 const decoder=new StringDecoder('utf8');let bytes=0,raw='';
 for await(const chunk of chunks){bytes+=chunk.byteLength;if(bytes>limit)fail(413,'Request too large');raw+=decoder.write(Buffer.from(chunk.buffer,chunk.byteOffset,chunk.byteLength));}
 return raw+decoder.end();
}

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
    !/^(?:source|comments|capture|permissions|sharing|profiles|presence|revoke|sync|comments\/[^/]+|comments\/[^/]+\/thread|context\/[^/]+|sync\/checkpoint|sync\/intents\/ack|backends|graphql)$/.test(
      tail,
    )
  )
    return null;
  return { fileId: match[1]!, parts: pathname.split("/").slice(1) };
}
