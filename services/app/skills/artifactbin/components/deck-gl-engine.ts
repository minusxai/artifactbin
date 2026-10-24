import { Deck } from "@deck.gl/core";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import * as maplibre from "maplibre-gl";
import {
  buildLayers,
  layerSpecs,
  paletteFor,
  extentOf,
  fittedView,
  legendScales,
  tooltipRecord,
  rgbCss,
  compactNumber,
  ATTRIBUTION,
  type MapViewState,
  type PickingInfo,
} from "../viz/deck-engine-core";
import { DeckViewModel, type DeckGLOptions } from "./deck-gl-model";
import type { DeckGLAdapter } from "./deck-gl";

/** Street styles and tiles are external network resources. basemap:none and supplied boundaries need no map service. */
export const DECK_BASEMAP_NETWORK_NOTICE =
  "Street basemap uses external OpenFreeMap tiles.";
export const DECK_BASEMAP_UNAVAILABLE =
  "Street map unavailable: this browser has no WebGL2.";
export function mountDeckGL(
  host: HTMLElement,
  initial: DeckGLOptions,
): DeckGLAdapter {
  const doc = host.ownerDocument,
    win = doc.defaultView!;
  const root = doc.createElement("figure");
  root.setAttribute("part", "map");
  root.style.cssText = "position:relative;margin:0;overflow:hidden";
  const canvas = doc.createElement("div");
  canvas.style.cssText = "position:absolute;inset:0";
  root.append(canvas);
  const style = doc.createElement("style");
  style.textContent = `
    af-deck-gl figure[part="map"] .maplibregl-canvas{position:absolute;left:0;top:0}
    af-deck-gl figure[part="map"] .maplibregl-canvas-container{position:absolute;inset:0}
    af-deck-gl figure[part="map"] .maplibregl-interactive{cursor:grab}
    af-deck-gl figure[part="map"] .maplibregl-interactive:active{cursor:grabbing}
    af-deck-gl figure[part="map"] [data-af-deck-controls]{position:absolute;right:8px;top:32px;z-index:1;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--border,#cfbea2);border-radius:var(--radius-md,calc(var(--radius,.625rem) - .125rem));background:var(--background,#f4ead9);color:var(--foreground,#1f2937);box-shadow:0 1px 3px rgba(0,0,0,.12)}
    af-deck-gl figure[part="map"] [data-af-deck-controls] button{display:flex;width:28px;height:28px;align-items:center;justify-content:center;padding:0;border:0;background:transparent;color:inherit;cursor:pointer}
    af-deck-gl figure[part="map"] [data-af-deck-controls] button+button{border-top:1px solid var(--border,#cfbea2)}
    af-deck-gl figure[part="map"] [data-af-deck-controls] button:hover{background:var(--muted,rgba(0,0,0,.06))}
    af-deck-gl figure[part="map"] [data-af-deck-controls] button:focus-visible{position:relative;z-index:1;outline:2px solid var(--ring,#2a5bd7);outline-offset:-2px}
    af-deck-gl figure[part="map"] [data-af-deck-legend]{position:absolute;left:8px;bottom:20px;z-index:1;box-sizing:border-box;display:flex;max-width:45%;flex-direction:column;gap:8px;border:1px solid var(--border,#cfbea2);border-radius:var(--radius-md,calc(var(--radius,.625rem) - .125rem));background:color-mix(in srgb,var(--background,#f4ead9) 90%,transparent);color:var(--foreground,#1f2937);padding:6px 8px;font-family:inherit;font-size:11px;line-height:1.25;box-shadow:0 1px 3px rgba(0,0,0,.12)}
    af-deck-gl figure[part="map"] [data-af-deck-legend] [data-af-deck-entry]{display:flex;flex-direction:column;gap:4px}
    af-deck-gl figure[part="map"] [data-af-deck-legend] [data-af-deck-label]{color:var(--muted-foreground,#64748b);font-weight:500}
    af-deck-gl figure[part="map"] [data-af-deck-ramp]{display:flex;align-items:center;gap:6px;white-space:nowrap}
    af-deck-gl figure[part="map"] [data-af-deck-ramp-bar]{display:block;flex:0 0 96px;width:96px;height:8px;border-radius:var(--radius-sm,calc(var(--radius,.625rem) - .25rem))}
    af-deck-gl figure[part="map"] [data-af-deck-swatches]{display:flex;flex-wrap:wrap;gap:2px 8px;margin:0;padding:0;list-style:none}
    af-deck-gl figure[part="map"] [data-af-deck-swatch]{display:flex;align-items:center;gap:4px;min-width:0}
    af-deck-gl figure[part="map"] [data-af-deck-dot]{width:8px;height:8px;flex:0 0 8px;border-radius:50%}
    af-deck-gl figure[part="map"] [data-af-deck-swatch-label]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  `;
  root.append(style);
  const controls = doc.createElement("div");
  controls.setAttribute("data-af-deck-controls", "");
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "Map controls");
  root.append(controls);
  const legend = doc.createElement("div");
  legend.setAttribute("part", "legend");
  legend.setAttribute("data-af-deck-legend", "");
  legend.setAttribute("role", "group");
  legend.setAttribute("aria-label", "Map legend");
  root.append(legend);
  const credit = doc.createElement("p");
  credit.style.cssText =
    "position:absolute;bottom:0;margin:4px;background:var(--card,white);font-size:11px";
  root.append(credit);
  const tooltip = doc.createElement("div");
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  tooltip.style.cssText =
    "position:absolute;pointer-events:none;background:var(--card,white);color:var(--foreground,#172033);padding:8px;white-space:pre-wrap";
  root.append(tooltip);
  host.append(root);
  let options = initial,
    disposed = false,
    deck: Deck | undefined,
    map: maplibre.Map | undefined,
    overlay: MapLibreOverlay | undefined,
    mode = "",
    fitted: MapViewState;
  let model: DeckViewModel | undefined;
  const hover = (info: PickingInfo & { x?: number; y?: number }) => {
    const record =
      options.tooltip === false
        ? null
        : tooltipRecord(
            info.object,
            Array.isArray(options.tooltip) ? options.tooltip : null,
          );
    tooltip.hidden = !record;
    if (record) {
      tooltip.textContent = Object.entries(record)
        .map(
          ([k, v]) =>
            `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
        )
        .join("\n");
      tooltip.style.left = `${info.x ?? 0}px`;
      tooltip.style.top = `${info.y ?? 0}px`;
    }
  };
  const syncView = () => {
    if (!model) return;
    deck?.setProps({ viewState: model.view });
    map?.jumpTo({
      center: [model.view.longitude, model.view.latitude],
      zoom: model.view.zoom,
      pitch: model.view.pitch,
      bearing: model.view.bearing,
    });
  };
  for (const [label, delta] of [
    ["Zoom in", 1],
    ["Zoom out", -1],
    ["Reset view", 0],
  ] as const) {
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("width", "16");
    icon.setAttribute("height", "16");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "1.5");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    icon.setAttribute("aria-hidden", "true");
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      delta > 0
        ? "M12 5v14M5 12h14"
        : delta < 0
          ? "M5 12h14"
          : "M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
    );
    icon.append(path);
    button.append(icon);
    button.addEventListener("click", () => {
      if (!model) return;
      if (delta)
        model.move(
          {
            ...model.view,
            zoom: Math.max(0, Math.min(20, model.view.zoom + delta)),
          },
          true,
        );
      else model.reset(fitted);
      syncView();
    });
    controls.append(button);
  }
  const leave = () => {
    tooltip.hidden = true;
  };
  root.addEventListener("pointerleave", leave);
  const destroy = () => {
    overlay = undefined;
    if (map) {
      map.remove();
      map = undefined;
    }
    deck?.finalize();
    deck = undefined;
    canvas.replaceChildren();
  };
  const render = () => {
    if (disposed) return;
    const dark = options.colorMode === "dark",
      palette = paletteFor(dark),
      built = buildLayers(
        layerSpecs(options.layers),
        options.data,
        options.boundaries ?? {},
        palette,
      ),
      layers = built.map((b) => b.layer);
    const height = Number.isFinite(options.height)
      ? Math.max(1, options.height!)
      : 420;
    root.style.height = `${height}px`;
    root.setAttribute("role", "img");
    root.setAttribute("aria-label", options.title ?? "Map");
    fitted = fittedView(
      options.initialViewState,
      extentOf(built),
      host.clientWidth,
      height,
    );
    if (!model) model = new DeckViewModel(fitted);
    else model.fit(fitted);
    const wanted = options.basemap ?? "auto",
      next =
        wanted === "none"
          ? "none"
          : wanted === "auto"
            ? dark
              ? "dark"
              : "light"
            : wanted;
    if (next !== mode) {
      destroy();
      mode = next;
      if (next !== "none") {
        try {
          map = new maplibre.Map({
            container: canvas,
            style: `https://tiles.openfreemap.org/styles/${next === "dark" ? "dark" : "positron"}`,
            center: [model.view.longitude, model.view.latitude],
            zoom: model.view.zoom,
            pitch: model.view.pitch,
            bearing: model.view.bearing,
            attributionControl: false,
          });
          overlay = new MapLibreOverlay({
            interleaved: true,
            layers: layers as never,
            onHover: hover as never,
          });
          map.addControl(overlay);
          map.on("move", (event: { originalEvent?: unknown }) => {
            if (!map || !model) return;
            const center = map.getCenter();
            model.move(
              {
                longitude: center.lng,
                latitude: center.lat,
                zoom: map.getZoom(),
                pitch: map.getPitch(),
                bearing: map.getBearing(),
              },
              !!event.originalEvent,
            );
          });
          credit.textContent = `${ATTRIBUTION} ${DECK_BASEMAP_NETWORK_NOTICE}`;
        } catch (error) {
          if (!(error instanceof maplibre.GPUInitializationError)) throw error;
          map = undefined;
          credit.textContent = DECK_BASEMAP_UNAVAILABLE;
        }
      } else credit.textContent = "";
      if (!map)
        deck = new Deck({
          parent: canvas,
          width: "100%",
          height: "100%",
          controller: true,
          layers: layers as never,
          viewState: model.view,
          onHover: hover as never,
          onViewStateChange: ({ viewState, interactionState }) => {
            model!.move(
              viewState as MapViewState,
              Object.values(interactionState ?? {}).some(Boolean),
            );
            deck?.setProps({ viewState: model!.view });
            return viewState;
          },
        });
    }
    deck?.setProps({ layers: layers as never, viewState: model.view });
    overlay?.setProps({ layers: layers as never, onHover: hover as never });
    syncView();
    legend.replaceChildren();
    legend.hidden = options.legend === false;
    if (options.legend !== false)
      for (const scale of legendScales(built, palette)) {
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
          min.textContent = compactNumber.format(scale.min);
          const bar = doc.createElement("span");
          bar.setAttribute("data-af-deck-ramp-bar", "");
          bar.setAttribute(
            "aria-label",
            `${scale.label}: ${compactNumber.format(scale.min)} to ${compactNumber.format(scale.max)}`,
          );
          bar.setAttribute("role", "img");
          bar.style.background = `linear-gradient(to right,${scale.colors.map(rgbCss).join(",")})`;
          const max = doc.createElement("span");
          max.textContent = compactNumber.format(scale.max);
          ramp.append(min, bar, max);
          entry.append(ramp);
        } else {
          const swatches = doc.createElement("ul");
          swatches.setAttribute("data-af-deck-swatches", "");
          for (const item of scale.entries) {
            const row = doc.createElement("li"),
              dot = doc.createElement("span");
            row.setAttribute("data-af-deck-swatch", "");
            dot.setAttribute("data-af-deck-dot", "");
            dot.setAttribute("aria-hidden", "true");
            dot.style.background = rgbCss(item.color);
            const value = doc.createElement("span");
            value.setAttribute("data-af-deck-swatch-label", "");
            value.textContent = String(item.value);
            row.append(dot, value);
            swatches.append(row);
          }
          entry.append(swatches);
        }
        legend.append(entry);
      }
  };
  const observer =
    typeof win.ResizeObserver === "function"
      ? new win.ResizeObserver(render)
      : undefined;
  observer?.observe(host);
  try {
    render();
  } catch (error) {
    destroy();
    observer?.disconnect();
    root.remove();
    throw error;
  }
  return {
    update(next) {
      options = next;
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      destroy();
      root.remove();
    },
  };
}
