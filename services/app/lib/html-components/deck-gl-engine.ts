/**
 * Internal: lazily loaded WebGL engine behind af-deck-gl (deck.gl plus optional MapLibre basemap).
 * Used by: deck-gl.ts via import('./deck-gl-engine'). The build re-bundles this file as a closed
 *   graph, so its helpers live in deck-gl-model.ts, never in a new module.
 */
import { Deck } from "@deck.gl/core";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import * as maplibre from "maplibre-gl";
import {
  buildLayers, layerSpecs, paletteFor, extentOf, fittedView, legendScales, tooltipRecord, rgbCss,
  compactNumber, ATTRIBUTION, type MapViewState, type PickingInfo,
} from "../viz/deck-engine-core";
import {
  DeckViewModel, DECK_CONTROLS, basemapMode, controlButton, createDeckChrome, legendEntry,
  tooltipText, type DeckGLOptions,
} from "./deck-gl-model";
import type { DeckGLAdapter } from "./deck-gl";

/** Street styles and tiles are external network resources.
 * basemap:none and supplied boundaries need no map service. */
export const DECK_BASEMAP_NETWORK_NOTICE =
  "Street basemap uses external OpenFreeMap tiles.";
export const DECK_BASEMAP_UNAVAILABLE =
  "Street map unavailable: this browser has no WebGL2.";
export function mountDeckGL(host: HTMLElement, initial: DeckGLOptions): DeckGLAdapter {
  const doc = host.ownerDocument,
    win = doc.defaultView!;
  const { root, canvas, controls, legend, credit, tooltip } = createDeckChrome(doc);
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
        : tooltipRecord(info.object, Array.isArray(options.tooltip) ? options.tooltip : null);
    tooltip.hidden = !record;
    if (record) {
      tooltip.textContent = tooltipText(record);
      tooltip.style.left = `${info.x ?? 0}px`;
      tooltip.style.top = `${info.y ?? 0}px`;
    }
  };
  // The model owns the view; deck and the street map are both driven from it.
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
  for (const [label, delta, d] of DECK_CONTROLS) {
    const button = controlButton(doc, label, d);
    button.addEventListener("click", () => {
      if (!model) return;
      // Button zoom counts as a reader gesture, so later resizes stop refitting.
      if (delta)
        model.move(
          { ...model.view, zoom: Math.max(0, Math.min(20, model.view.zoom + delta)) },
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
      specs = layerSpecs(options.layers),
      built = buildLayers(specs, options.data, options.boundaries ?? {}, palette),
      layers = built.map((b) => b.layer);
    const height = Number.isFinite(options.height) ? Math.max(1, options.height!) : 420;
    root.style.height = `${height}px`;
    root.setAttribute("role", "img");
    root.setAttribute("aria-label", options.title ?? "Map");
    fitted = fittedView(options.initialViewState, extentOf(built), host.clientWidth, height);
    if (!model) model = new DeckViewModel(fitted);
    else model.fit(fitted);
    const next = basemapMode(options.basemap, dark);
    // Only a basemap change rebuilds the renderer; other updates just set new layers.
    if (next !== mode) {
      destroy();
      mode = next;
      if (next !== "none") {
        try {
          map = new maplibre.Map({
            container: canvas,
            style:
              "https://tiles.openfreemap.org/styles/" + (next === "dark" ? "dark" : "positron"),
            center: [model.view.longitude, model.view.latitude],
            zoom: model.view.zoom,
            pitch: model.view.pitch,
            bearing: model.view.bearing,
            attributionControl: false,
          });
          overlay = new MapLibreOverlay({
            interleaved: true, layers: layers as never, onHover: hover as never,
          });
          map.addControl(overlay);
          map.on("move", (event: { originalEvent?: unknown }) => {
            if (!map || !model) return;
            const center = map.getCenter();
            // Programmatic jumpTo has no originalEvent and must not count as a reader gesture.
            model.move(
              {
                longitude: center.lng, latitude: center.lat,
                zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(),
              },
              !!event.originalEvent,
            );
          });
          credit.textContent = `${ATTRIBUTION} ${DECK_BASEMAP_NETWORK_NOTICE}`;
        } catch (error) {
          // No WebGL2: fall back to a plain deck.gl canvas and say why.
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
      for (const scale of legendScales(built, palette))
        legend.append(legendEntry(doc, scale, (n) => compactNumber.format(n), rgbCss));
  };
  const observer =
    typeof win.ResizeObserver === "function" ? new win.ResizeObserver(render) : undefined;
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
