/**
 * Internal: options type, view/generation state and framework-free DOM chrome for af-deck-gl.
 * Used by: deck-gl.ts and deck-gl-engine.ts. Type-only imports from deck-engine-core keep deck.gl
 *   out of deck-gl.js; the engine passes formatters in instead.
 */
import type { MapViewState, Feature, Row, ColorScale } from "../viz/deck-engine-core";
export interface DeckGLOptions {
  data: readonly Row[];
  layers: unknown;
  basemap?: "auto" | "light" | "dark" | "none";
  colorMode?: "light" | "dark";
  initialViewState?: Partial<MapViewState>;
  tooltip?: boolean | string[];
  legend?: boolean;
  title?: string;
  height?: number;
  /** Geometry supplied by the author or bundled with the document; never fetched implicitly. */
  boundaries?: Readonly<Record<string, Feature[]>>;
}
/** Fit follows data and size until a reader gesture; reset resumes fitting. */
export class DeckViewModel {
  private moved = false;
  constructor(public view: MapViewState) {}
  fit(next: MapViewState): void {
    if (!this.moved) this.view = next;
  }
  move(next: MapViewState, byReader: boolean): void {
    this.moved ||= byReader;
    this.view = next;
  }
  reset(next: MapViewState): void {
    this.moved = false;
    this.view = next;
  }
}
/** Async adapters must never attach after replacement or disconnection. */
export class DeckGeneration {
  private generation = 0;
  next(): () => boolean {
    const version = ++this.generation;
    return () => version === this.generation;
  }
  invalidate(): void {
    this.generation++;
  }
}
/** Map chrome CSS scoped to `af-deck-gl figure[part=map]`; tokens fall back to built-ins. */
export const DECK_GL_CSS =
  '\n    af-deck-gl figure[part="map"] .maplibregl-canvas{position:absolute;left:0;top:0}\n' +
  '    af-deck-gl figure[part="map"] .maplibregl-canvas-container{position:absolute;inset:0}\n' +
  '    af-deck-gl figure[part="map"] .maplibregl-interactive{cursor:grab}\n' +
  '    af-deck-gl figure[part="map"] .maplibregl-interactive:active{cursor:grabbing}\n' +
  '    af-deck-gl figure[part="map"] [data-af-deck-controls]{position:absolute;right:8px;' +
  'top:32px;z-index:1;display:flex;flex-direction:column;overflow:hidden;' +
  'border:1px solid var(--border,#cfbea2);border-radius:var(--radius-md,calc(var(--radius,' +
  '.625rem) - .125rem));background:var(--background,#f4ead9);color:var(--foreground,#1f2937);' +
  'box-shadow:0 1px 3px rgba(0,0,0,.12)}\n' +
  '    af-deck-gl figure[part="map"] [data-af-deck-controls] button{display:flex;width:28px;' +
  'height:28px;align-items:center;justify-content:center;padding:0;border:0;' +
  'background:transparent;color:inherit;cursor:pointer}\n' +
  '    af-deck-gl figure[part="map"] [data-af-deck-controls] button+button{border-top:1px solid v' +
  'ar(--border,#cfbea2)}\n    af-deck-gl figure[part="map"] [data-af-deck-controls] button:hover{' +
  'background:var(--muted,rgba(0,0,0,.06))}\n' +
  '    af-deck-gl figure[part="map"] [data-af-deck-controls] button:focus-visible{position:relati' +
  've;z-index:1;outline:2px solid var(--ring,#2a5bd7);outline-offset:-2px}\n' +
  '    af-deck-gl figure[part="map"] [data-af-deck-legend]{position:absolute;left:8px;' +
  'bottom:20px;z-index:1;box-sizing:border-box;display:flex;max-width:45%;flex-direction:column;' +
  'gap:8px;border:1px solid var(--border,#cfbea2);border-radius:var(--radius-md,' +
  'calc(var(--radius,.625rem) - .125rem));background:color-mix(in srgb,var(--background,' +
  '#f4ead9) 90%,transparent);color:var(--foreground,#1f2937);padding:6px 8px;font-family:inherit;' +
  'font-size:11px;line-height:1.25;box-shadow:0 1px 3px rgba(0,0,0,.12)}\n' +
  '    af-deck-gl figure[part="map"] [data-af-deck-legend] [data-af-deck-entry]{display:flex;' +
  'flex-direction:column;gap:4px}\n    af-deck-gl figure[part="map"] [data-af-deck-legend] [data-' +
  'af-deck-label]{color:var(--muted-foreground,#64748b);font-weight:500}\n' +
  '    af-deck-gl figure[part="map"] [data-af-deck-ramp]{display:flex;align-items:center;gap:6px;' +
  'white-space:nowrap}\n    af-deck-gl figure[part="map"] [data-af-deck-ramp-bar]{display:block;' +
  'flex:0 0 96px;width:96px;height:8px;border-radius:var(--radius-sm,calc(var(--radius,' +
  '.625rem) - .25rem))}\n    af-deck-gl figure[part="map"] [data-af-deck-swatches]{display:flex;' +
  'flex-wrap:wrap;gap:2px 8px;margin:0;padding:0;list-style:none}\n' +
  '    af-deck-gl figure[part="map"] [data-af-deck-swatch]{display:flex;align-items:center;' +
  'gap:4px;min-width:0}\n    af-deck-gl figure[part="map"] [data-af-deck-dot]{width:8px;' +
  'height:8px;flex:0 0 8px;border-radius:50%}\n' +
  '    af-deck-gl figure[part="map"] [data-af-deck-swatch-label]{overflow:hidden;' +
  'text-overflow:ellipsis;white-space:nowrap}\n  ';
const setAttrs = (node: Element, attrs: Record<string, string>): void => {
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
};
/** Build the detached figure (canvas, style, controls, legend, credit, tooltip) in paint order. */
export function createDeckChrome(doc: Document) {
  const root = doc.createElement("figure");
  root.setAttribute("part", "map");
  root.style.cssText = "position:relative;margin:0;overflow:hidden";
  const canvas = doc.createElement("div");
  canvas.style.cssText = "position:absolute;inset:0";
  root.append(canvas);
  const style = doc.createElement("style");
  style.textContent = DECK_GL_CSS;
  root.append(style);
  const controls = doc.createElement("div");
  setAttrs(controls, { "data-af-deck-controls": "", role: "group", "aria-label": "Map controls" });
  root.append(controls);
  const legend = doc.createElement("div");
  setAttrs(legend, {
    part: "legend", "data-af-deck-legend": "", role: "group", "aria-label": "Map legend",
  });
  root.append(legend);
  const credit = doc.createElement("p");
  credit.style.cssText =
    "position:absolute;bottom:0;margin:4px;background:var(--card,white);font-size:11px";
  root.append(credit);
  const tooltip = doc.createElement("div");
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  tooltip.style.cssText =
    "position:absolute;pointer-events:none;background:var(--card,white);" +
    "color:var(--foreground,#172033);padding:8px;white-space:pre-wrap";
  root.append(tooltip);
  return { root, canvas, controls, legend, credit, tooltip };
}
/** Zoom buttons: [label, zoom delta (0 = reset to the fitted view), icon path]. */
export const DECK_CONTROLS = [
  ["Zoom in", 1, "M12 5v14M5 12h14"],
  ["Zoom out", -1, "M5 12h14"],
  ["Reset view", 0, "M3 12a9 9 0 1 0 3-6.7M3 4v5h5"],
] as const;
export function controlButton(doc: Document, label: string, d: string): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  setAttrs(icon, {
    viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor",
    "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  icon.append(path);
  button.append(icon);
  return button;
}
/** One `key: value` line per field; objects are shown as JSON. */
export function tooltipText(record: Row): string {
  return Object.entries(record)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("\n");
}
/** auto follows the resolved colour mode; none draws deck.gl without a street map. */
export function basemapMode(wanted: DeckGLOptions["basemap"], dark: boolean): string {
  const mode = wanted ?? "auto";
  return mode === "auto" ? (dark ? "dark" : "light") : mode;
}
/** One legend entry: a min-to-max colour ramp or a list of category swatches. */
export function legendEntry(
  doc: Document,
  scale: ColorScale,
  format: (n: number) => string,
  css: (color: readonly number[]) => string,
): HTMLElement {
  const entry = doc.createElement("div");
  entry.setAttribute("data-af-deck-entry", "");
  const label = doc.createElement("strong");
  label.setAttribute("data-af-deck-label", "");
  label.textContent = scale.label;
  entry.append(label);
  if (scale.kind === "ramp") {
    const ramp = doc.createElement("div");
    ramp.setAttribute("data-af-deck-ramp", "");
    const min = doc.createElement("span");
    min.textContent = format(scale.min);
    const bar = doc.createElement("span");
    setAttrs(bar, {
      "data-af-deck-ramp-bar": "",
      "aria-label": `${scale.label}: ${format(scale.min)} to ${format(scale.max)}`,
      role: "img",
    });
    bar.style.background = `linear-gradient(to right,${scale.colors.map(css).join(",")})`;
    const max = doc.createElement("span");
    max.textContent = format(scale.max);
    ramp.append(min, bar, max);
    entry.append(ramp);
    return entry;
  }
  const swatches = doc.createElement("ul");
  swatches.setAttribute("data-af-deck-swatches", "");
  for (const item of scale.entries) {
    const row = doc.createElement("li"),
      dot = doc.createElement("span");
    row.setAttribute("data-af-deck-swatch", "");
    setAttrs(dot, { "data-af-deck-dot": "", "aria-hidden": "true" });
    dot.style.background = css(item.color);
    const value = doc.createElement("span");
    value.setAttribute("data-af-deck-swatch-label", "");
    value.textContent = String(item.value);
    row.append(dot, value);
    swatches.append(row);
  }
  entry.append(swatches);
  return entry;
}
