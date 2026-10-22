/** Ordinary JSON data decoding only; never a resource loader or expression compiler. */
export interface ChartInlineDataFormat {
  type?: "json";
  copy?: boolean;
}
export function readChartInlineData(
  data: unknown,
  format?: ChartInlineDataFormat | null,
): unknown[] {
  if (format !== undefined && format !== null) {
    if (
      typeof format !== "object" ||
      Array.isArray(format) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(format)) ||
      Object.values(Object.getOwnPropertyDescriptors(format)).some(
        (p) => !Object.hasOwn(p, "value"),
      ) ||
      Object.keys(format).some((k) => !["type", "copy"].includes(k)) ||
      (format.type !== undefined && format.type !== "json") ||
      (format.copy !== undefined && typeof format.copy !== "boolean")
    )
      throw Error("Unsupported chart inline format");
  }
  if (!Array.isArray(data) || data.length > 10000)
    throw Error("Chart inline data unavailable");
  let nodes = 0,
    characters = 0;
  const check = (value: unknown, depth: number): void => {
    if (++nodes > 200000 || depth > 16) throw Error("Chart inline data limit");
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value === "string") {
      characters += value.length;
      if (characters > 2000000) throw Error("Chart inline data limit");
      return;
    }
    if (!value || typeof value !== "object")
      throw Error("Chart inline data unavailable");
    if (Array.isArray(value) && value.length > 10000)
      throw Error("Chart inline data limit");
    const prototype = Object.getPrototypeOf(value);
    if (
      !Array.isArray(value) &&
      prototype !== Object.prototype &&
      prototype !== null
    )
      throw Error("Chart inline data unavailable");
    for (const [key, property] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (Array.isArray(value) && key === "length") continue;
      if (!Object.hasOwn(property, "value"))
        throw Error("Chart inline data unavailable");
      characters += key.length;
      if (characters > 2000000) throw Error("Chart inline data limit");
      check(property.value, depth + 1);
    }
  };
  check(data, 0);
  return format?.copy ? JSON.parse(JSON.stringify(data)) : data;
}
