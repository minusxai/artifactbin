import type { LocalDeclaration } from "./local-contracts.ts";
/** Both the migration boundary and emitted boot validate the same viewer-state shape. */
export function validLocalValue(d: LocalDeclaration, value: unknown): boolean {
  // Kept inside this function: boot serializes the validator without module imports.
  function timestamp(v: unknown): boolean {
    if (typeof v === "number")
      return Number.isFinite(v) && Number.isFinite(new Date(v).getTime());
    if (typeof v !== "string") return false;
    const match =
      /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i.exec(
        v.trim(),
      );
    if (!match) return false;
    const calendar = new Date(`${match[1]}T00:00:00.000Z`);
    if (
      !Number.isFinite(calendar.getTime()) ||
      calendar.toISOString().slice(0, 10) !== match[1]
    )
      return false;
    const hour = match[2] ?? "00",
      minute = match[3] ?? "00",
      second = match[4] ?? "00";
    if (+hour > 23 || +minute > 59 || +second > 59) return false;
    let offset = (match[6] ?? "Z").toUpperCase();
    if (/^[+-]\d{2}$/.test(offset)) offset += ":00";
    if (/^[+-]\d{4}$/.test(offset))
      offset = offset.slice(0, 3) + ":" + offset.slice(3);
    return Number.isFinite(
      new Date(
        `${match[1]}T${hour}:${minute}:${second}.${(match[5] ?? "").padEnd(3, "0").slice(0, 3)}${offset}`,
      ).getTime(),
    );
  }
  function scalar(v: unknown, type: string): boolean {
    if (v === null) return true;
    if (type === "timestamp") return timestamp(v);
    if (type === "date")
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(v);
    if (type === "user") return typeof v === "string";
    return (
      v === null ||
      (typeof v === type && (typeof v !== "number" || Number.isFinite(v)))
    );
  }
  if (d.type !== "table") return scalar(value, d.type);
  if (
    !Array.isArray(d.columns) ||
    d.columns.length > 256 ||
    d.columns.some((c) => !c || typeof c !== "object") ||
    new Set(d.columns.map((c) => c.name)).size !== d.columns.length ||
    d.columns.some(
      (c) =>
        !c ||
        typeof c.name !== "string" ||
        ["__proto__", "constructor", "prototype"].includes(c.name) ||
        !["string", "number", "boolean", "date", "timestamp", "user"].includes(
          c.type,
        ),
    )
  )
    return false;
  return (
    Array.isArray(value) &&
    value.length <= 10_000 &&
    value.every(
      (row) =>
        row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        Object.keys(row).every((key) =>
          d.columns.some((c) => c.name === key),
        ) &&
        d.columns.every((c) =>
          scalar(Object.hasOwn(row, c.name) ? row[c.name] : null, c.type),
        ),
    )
  );
}

/** Offline scalar-default canonicalization; table cells retain their authored values. */
export function normalizeLocalTimestamp(value: unknown): string {
  if (
    !validLocalValue(
      { name: "timestamp", type: "timestamp", default: null },
      value,
    ) ||
    value === null
  )
    throw Error("Invalid timestamp");
  if (typeof value === "number") return new Date(value).toISOString();
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i.exec(
      (value as string).trim(),
    )!;
  let offset = (match[6] ?? "Z").toUpperCase();
  if (/^[+-]\d{2}$/.test(offset)) offset += ":00";
  if (/^[+-]\d{4}$/.test(offset))
    offset = offset.slice(0, 3) + ":" + offset.slice(3);
  return new Date(
    `${match[1]}T${match[2] ?? "00"}:${match[3] ?? "00"}:${match[4] ?? "00"}.${(match[5] ?? "").padEnd(3, "0").slice(0, 3)}${offset}`,
  ).toISOString();
}
