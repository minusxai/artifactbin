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
  style.textContent =
    "af-deck-gl .maplibregl-canvas{position:absolute;left:0;top:0}af-deck-gl .maplibregl-canvas-container{position:absolute;inset:0}af-deck-gl .maplibregl-interactive{cursor:grab}af-deck-gl .maplibregl-interactive:active{cursor:grabbing}";
  root.append(style);
  const controls = doc.createElement("div");
  controls.style.cssText =
    "position:absolute;right:8px;top:8px;display:flex;gap:4px";
  root.append(controls);
  const legend = doc.createElement("div");
  legend.setAttribute("part", "legend");
  legend.style.cssText =
    "position:absolute;left:8px;bottom:28px;background:var(--card,white);color:var(--foreground,#172033);padding:8px";
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
    button.textContent = label;
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
        const label = doc.createElement("strong");
        label.textContent = scale.label;
        entry.append(label);
        if (scale.kind === "ramp") {
          const ramp = doc.createElement("div");
          ramp.textContent = `${compactNumber.format(scale.min)} — ${compactNumber.format(scale.max)}`;
          ramp.style.background = `linear-gradient(to right,${scale.colors.map(rgbCss).join(",")})`;
          entry.append(ramp);
        } else
          for (const item of scale.entries) {
            const row = doc.createElement("div"),
              dot = doc.createElement("span");
            dot.textContent = "● ";
            dot.style.color = rgbCss(item.color);
            row.append(dot, doc.createTextNode(String(item.value)));
            entry.append(row);
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
