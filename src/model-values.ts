import type { Json } from "./contracts.ts";
import { fail } from "./errors.ts";
export function text(value: unknown, max = 10000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(422, "Invalid text");
  return value;
}
export function canonical(value: Json): string {
  return value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? "[" + value.map(canonical).join(",") + "]"
      : "{" +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ":" + canonical(value[key]!))
          .join(",") +
        "}";
}
