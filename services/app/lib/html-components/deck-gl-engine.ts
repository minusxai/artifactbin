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
  MAP_CLASSES,
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
  style.textContent =
    "af-deck-gl .maplibregl-canvas{position:absolute;left:0;top:0}af-deck-gl .maplibregl-canvas-container{position:absolute;inset:0}af-deck-gl .maplibregl-interactive{cursor:grab}af-deck-gl .maplibregl-interactive:active{cursor:grabbing}";
  root.append(style);
  const controls = doc.createElement("div");
  controls.className = MAP_CLASSES.controls;
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "Map controls");
  root.append(controls);
  const legend = doc.createElement("div");
  legend.setAttribute("part", "legend");
  legend.className = MAP_CLASSES.legend;
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
    button.className = MAP_CLASSES.button;
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
        entry.className = MAP_CLASSES.legendEntry;
        const label = doc.createElement("strong");
        label.className = MAP_CLASSES.legendLabel;
        label.textContent = scale.label;
        entry.append(label);
        if (scale.kind === "ramp") {
          const ramp = doc.createElement("div");
          ramp.className = MAP_CLASSES.ramp;
          const min = doc.createElement("span");
          min.textContent = compactNumber.format(scale.min);
          const bar = doc.createElement("span");
          bar.className = MAP_CLASSES.rampBar;
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
          swatches.className = MAP_CLASSES.swatches;
          for (const item of scale.entries) {
            const row = doc.createElement("li"),
              dot = doc.createElement("span");
            row.className = MAP_CLASSES.swatch;
            dot.className = MAP_CLASSES.dot;
            dot.setAttribute("aria-hidden", "true");
            dot.style.background = rgbCss(item.color);
            const value = doc.createElement("span");
            value.className = MAP_CLASSES.swatchLabel;
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
