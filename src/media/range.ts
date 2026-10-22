import type { MediaRange } from "./contracts.ts";
/** v1 supports exactly one bytes range; malformed/multiple/unsatisfiable values throw. */
export function mediaRange(
  value: string | undefined,
  size: number,
): MediaRange | null {
  if (!Number.isSafeInteger(size) || size < 0)
    throw new Error("Invalid media size");
  if (value === undefined) return null;
  const found = /^bytes=([0-9]*)-([0-9]*)$/.exec(value);
  if (!found || (!found[1] && !found[2]) || size === 0)
    throw new Error("Unsatisfiable media range");
  const number = (text: string) => {
    const n = Number(text);
    if (!Number.isSafeInteger(n)) throw new Error("Invalid media range");
    return n;
  };
  if (!found[1]) {
    const suffix = number(found[2]!);
    if (suffix === 0) throw new Error("Invalid media range");
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = number(found[1]);
  const end = found[2] ? Math.min(number(found[2]), size - 1) : size - 1;
  if (start >= size || end < start)
    throw new Error("Unsatisfiable media range");
  return { start, end };
}
