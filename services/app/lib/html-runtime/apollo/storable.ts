/**
 * What local state can hold: strings, finite numbers, booleans, null, dense
 * arrays and plain objects. Pure; shared by the client, the browser store and
 * state URLs.
 */
import type { HtmlJson as AfJson } from "@artifactbin/contracts";

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number") return String(value);
  if (typeof value === "function") return "a function";
  if (value instanceof Date) return "a Date (store dates as ISO strings)";
  if (typeof value === "object" && value !== null)
    return "an instance of " + (value.constructor?.name || "a class");
  return typeof value;
}

export function check(value: unknown, path: string, seen: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new TypeError(`Cannot store ${describe(value)} at ${path}`);
  }
  if (typeof value !== "object")
    throw new TypeError(`Cannot store ${describe(value)} at ${path}`);
  if (seen.has(value)) throw new TypeError(`Cannot store a circular reference at ${path}`);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length)
      throw new TypeError(`Cannot store a sparse or extended array at ${path}`);
    seen.add(value);
    for (let index = 0; index < value.length; index++) check(value[index], `${path}[${index}]`, seen);
    seen.delete(value);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`Cannot store ${describe(value)} at ${path}`);
  if (Object.getOwnPropertySymbols(value).length)
    throw new TypeError(`Cannot store symbol keys at ${path}`);
  seen.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor))
      throw new TypeError(`Cannot store an accessor at ${path}.${key}`);
    if (descriptor.enumerable) check(descriptor.value, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

export function assertStorable(value: unknown): asserts value is AfJson {
  check(value, "value", new Set());
}
