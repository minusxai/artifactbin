import type { ConnectorCode, Json } from "./contracts.ts";
export class ConnectorError extends Error {
  readonly code: ConnectorCode;
  readonly outcome: "unknown" | "not-executed";
  constructor(
    code: ConnectorCode,
    outcome: "unknown" | "not-executed" = "not-executed",
  ) {
    super(`Connector ${code.toLowerCase()}`);
    this.code = code;
    this.outcome = outcome;
  }
}
export function snapshot(value: unknown, maxBytes: number): Json {
  const seen = new Set<object>();
  let bytes = 0;
  const count = (n: number) => {
    bytes += n;
    if (bytes > maxBytes) throw new ConnectorError("INVALID");
  };
  function walk(v: unknown, depth: number): void {
    if (depth > 32) throw new ConnectorError("INVALID");
    if (typeof v === "string") {
      count(Buffer.byteLength(v) + 2);
      return;
    }
    if (
      v === null ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    ) {
      count(1);
      return;
    }
    if (typeof v !== "object" || seen.has(v))
      throw new ConnectorError("INVALID");
    const proto = Object.getPrototypeOf(v);
    if (
      proto !== Object.prototype &&
      proto !== Array.prototype &&
      proto !== null
    )
      throw new ConnectorError("INVALID");
    count(2);
    if (Array.isArray(v) && v.length > maxBytes)
      throw new ConnectorError("INVALID");
    if (
      Array.isArray(v) &&
      (Object.keys(v).length !== v.length ||
        !Array.from({ length: v.length }, (_, i) => Object.hasOwn(v, i)).every(
          Boolean,
        ))
    )
      throw new ConnectorError("INVALID");
    seen.add(v);
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (typeof key !== "string" || !d.enumerable || !("value" in d))
        throw new ConnectorError("INVALID");
      count(Buffer.byteLength(key) + 1);
      walk(d.value, depth + 1);
    }
    seen.delete(v);
  }
  walk(value, 0);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > maxBytes) throw new ConnectorError("INVALID");
  return JSON.parse(text) as Json;
}
