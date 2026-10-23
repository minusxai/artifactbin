/**
 * `#af-state=<base64url of the local-state JSON>` on a page address: local
 * state carried in a URL. Pure and isomorphic (Node and browsers); no graphql.
 */
import type { HtmlJsonObject as AfJsonObject } from "@artifactbin/contracts";
import { AF_STATE_FRAGMENT, AF_STATE_URL_LIMIT } from "./apollo-contracts";
import type { StateFragment } from "./apollo-contracts";
import { check } from "./storable";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!, b = bytes[index + 1], c = bytes[index + 2];
    out += BASE64URL[a >> 2]! + BASE64URL[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) out += BASE64URL[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) out += BASE64URL[c & 63]!;
  }
  return out;
}

function fromBase64url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1)
    throw new TypeError("af-state is not base64url");
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let length = 0, buffer = 0, bits = 0;
  for (const character of text) {
    buffer = (buffer << 6) | BASE64URL.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[length++] = (buffer >> bits) & 255;
    }
  }
  return bytes.subarray(0, length);
}

const tooLarge = () => new TypeError(`State too large for a URL: the limit is 256 KB`);

export function encodeState(state: AfJsonObject): string {
  if (state === null || typeof state !== "object" || Array.isArray(state))
    throw new TypeError("Local state must be an object");
  check(state, "state", new Set());
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  if (bytes.byteLength > AF_STATE_URL_LIMIT) throw tooLarge();
  return base64url(bytes);
}

export function decodeState(encoded: string): AfJsonObject {
  if (typeof encoded !== "string" || !encoded) throw new TypeError("af-state is empty");
  // Every 4 characters carry 3 bytes: refuse oversized input before decoding it.
  if (encoded.length > Math.ceil((AF_STATE_URL_LIMIT * 4) / 3)) throw tooLarge();
  // Node's Buffer.toString("base64url") (the skill scripts) writes no padding; tolerate it anyway.
  const bytes = fromBase64url(encoded.replace(/=+$/, ""));
  if (bytes.byteLength > AF_STATE_URL_LIMIT) throw tooLarge();
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TypeError("af-state is not JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("af-state must hold a JSON object");
  check(value, "state", new Set());
  return value as AfJsonObject;
}

export function stateUrl(pageAddress: string, state: AfJsonObject): string {
  const base = String(pageAddress).split("#")[0]!;
  return `${base}#${AF_STATE_FRAGMENT}=${encodeState(state)}`;
}

export function readStateFragment(hash: string): StateFragment {
  const text = typeof hash === "string" ? hash.replace(/^#/, "") : "";
  const parts = text ? text.split("&") : [];
  const prefix = AF_STATE_FRAGMENT + "=";
  const index = parts.findIndex((part) => part.startsWith(prefix));
  if (index < 0) return { found: false, state: null, error: null, rest: text ? "#" + text : "" };
  const others = parts.filter((_, at) => at !== index);
  const rest = others.length ? "#" + others.join("&") : "";
  try {
    return { found: true, state: decodeState(parts[index]!.slice(prefix.length)), error: null, rest };
  } catch (error) {
    return { found: true, state: null, error: message(error), rest };
  }
}
