import { createHash } from "node:crypto";

function arrayIndex(key: string): number | null {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) return null;
  const value = Number(key);
  return Number.isSafeInteger(value) && value <= 0xffff_fffe ? value : null;
}

function compareCanonicalKeys(left: string, right: string): number {
  const leftIndex = arrayIndex(left), rightIndex = arrayIndex(right);
  if (leftIndex !== null && rightIndex !== null) return leftIndex - rightIndex;
  if (leftIndex !== null) return -1;
  if (rightIndex !== null) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Canonical receipt hash for the assembled native projection. Ordinary JSON
 * values keep nativeDigest's sorted-key JSON encoding; Uint8Array values are
 * framed as a distinct, length-delimited byte token so large files are not
 * expanded into one enumerable property per byte.
 */
export function nativeReceiptDigest(value: unknown): string {
  const hash = createHash("sha256");
  const write = (current: unknown, inArray = false): void => {
    if (current instanceof Uint8Array) {
      // Raw NUL is reserved by this encoding; JSON.stringify always escapes it.
      hash.update("\0native-receipt:uint8:");
      hash.update(String(current.byteLength));
      hash.update(":");
      hash.update(current);
      hash.update("\0");
      return;
    }
    if (Array.isArray(current)) {
      hash.update("[");
      for (let index = 0; index < current.length; index++) {
        if (index) hash.update(",");
        const item = current[index];
        if (
          item === undefined ||
          typeof item === "function" ||
          typeof item === "symbol"
        ) {
          hash.update("null");
        } else {
          write(item, true);
        }
      }
      hash.update("]");
      return;
    }
    if (current && typeof current === "object") {
      // Object.fromEntries receives lexically sorted keys in nativeDigest, but
      // JSON.stringify then emits integer-index keys first in numeric order.
      const entries = Object.entries(current).sort(([left], [right]) =>
        compareCanonicalKeys(left, right),
      );
      hash.update("{");
      let first = true;
      for (const [key, item] of entries) {
        if (
          item === undefined ||
          typeof item === "function" ||
          typeof item === "symbol"
        )
          continue;
        if (!first) hash.update(",");
        first = false;
        hash.update(JSON.stringify(key));
        hash.update(":");
        write(item);
      }
      hash.update("}");
      return;
    }
    const encoded = JSON.stringify(current);
    if (encoded === undefined) {
      if (inArray) hash.update("null");
      else throw new TypeError("Cannot hash an undefined receipt value");
    } else {
      hash.update(encoded);
    }
  };
  write(value);
  return hash.digest("hex");
}
