/** Validate resolved paints before SVGRenderer writes any attribute to the live DOM. */
export interface ChartPaintPolicy {
  isColor(value: string): boolean;
  /** Resolve one exact custom property to a color; returned text is revalidated. */
  resolveColor?(property: string): string;
}
export function assertChartPaints(
  scene: unknown,
  policy: ChartPaintPolicy,
): void {
  let count = 0;
  const color = (value: unknown) => {
    if (value == null) return value;
    const variable = typeof value === "string" && /^var\((--[A-Za-z_][A-Za-z0-9_-]{0,127})\)$/.exec(value);
    if (variable && policy.resolveColor) value = policy.resolveColor(variable[1]!);
    if (
      typeof value !== "string" ||
      !/^[a-zA-Z#]/.test(value) ||
      /[\\;{}]|\/\*|\b(?:var|env|attr|url)\s*\(/i.test(value) ||
      /^(?:inherit|initial|unset|revert|revert-layer)$/i.test(value) ||
      !(value.toLowerCase() === "none" || policy.isColor(value))
    )
      throw Error("Chart paint requires a resource-free color");
    return value;
  };
  const paint = (value: unknown) => {
    if (value && typeof value === "object") {
      const gradient = value as Record<string, unknown>;
      if (
        !["linear", "radial"].includes(String(gradient.gradient)) ||
        !Array.isArray(gradient.stops) ||
        gradient.stops.length > 256
      )
        throw Error("Unsupported chart gradient");
      if (
        gradient.id != null &&
        !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(String(gradient.id))
      )
        throw Error("Unsupported chart gradient identity");
      for (const stop of gradient.stops) {
        if (
          !Number.isFinite(stop?.offset) ||
          stop.offset < 0 ||
          stop.offset > 1
        )
          throw Error("Unsupported chart gradient stop");
        stop.color = color(stop?.color);
      }
      return value;
    } else return color(value);
  };
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object") return;
    if (++count > 100000 || depth > 64)
      throw Error("Chart scene exceeds limit");
    const item = node as Record<string, unknown>;
    if (item.fill != null) item.fill = paint(item.fill);
    if (item.stroke != null) item.stroke = paint(item.stroke);
    if (Array.isArray(item.items))
      for (const child of item.items) visit(child, depth + 1);
  };
  visit(scene, 0);
}
