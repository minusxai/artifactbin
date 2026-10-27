---
name: maps
description: Build native HTML maps with the pinned framework-free deck.gl API.
---

## Read first

Use deck.gl's own `Deck`, views and layer classes. The shipped module combines exports from `@deck.gl/core`, `@deck.gl/layers` and `@deck.gl/aggregation-layers`; it does not include React or the legacy `<af-deck-gl>` adapter.

## Contents

[Example](#offline-basemap-free-example) · [Theme](#theme-updates-and-lifetime) · [Data](#data-and-network-limits) · [API](#api-reference)

## Offline, basemap-free example

This example uses inline records and a native `MapView`, so it makes no tile or data requests.

```html
<div id="map" data-af-id="sample-map" role="img" aria-label="Three sample locations" style="position:relative;width:100%;height:360px"></div>
<table data-af-id="sample-map-values">
  <caption data-af-id="sample-map-caption">Sample values shown on the map</caption>
  <tbody><tr data-af-id="sample-map-west"><th scope="row" data-af-id="sample-map-west-name">West</th><td data-af-id="sample-map-west-value">14</td></tr>
  <tr data-af-id="sample-map-central"><th scope="row" data-af-id="sample-map-central-name">Central</th><td data-af-id="sample-map-central-value">24</td></tr>
  <tr data-af-id="sample-map-east"><th scope="row" data-af-id="sample-map-east-name">East</th><td data-af-id="sample-map-east-value">19</td></tr></tbody>
</table>
<p id="map-status" data-af-id="sample-map-status" role="status" hidden></p>
<script type="application/json" data-af="state">{"mapView":{"longitude":-98,"latitude":39,"zoom":3.2,"pitch":0,"bearing":0}}</script>
<script src="/af/core.js" data-af="core"></script>
<script type="module">
const host = document.querySelector("#map");
const status = document.querySelector("#map-status");
const points = [
  {name: "West", position: [-122.4, 37.8], value: 14},
  {name: "Central", position: [-96.8, 38.5], value: 24},
  {name: "East", position: [-73.9, 40.7], value: 19}
];
let deck;
let saveTimer;
let latestViewState;
let disposed = false;
let resize;
let themeObserver;
let client;
let viewQuery;
const dark = () => document.documentElement.dataset.afDark === "true";

function showFallback() {
  status.hidden = false;
  status.textContent = "Map unavailable here. The sample values remain available in the table.";
}

function persistView() {
  if (!client || !viewQuery || !latestViewState) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  client.updateQuery({query: viewQuery}, () => ({mapView: {
    longitude: latestViewState.longitude, latitude: latestViewState.latitude,
    zoom: latestViewState.zoom, pitch: latestViewState.pitch, bearing: latestViewState.bearing
  }}));
}

try {
  const [{client: apollo, gql}, {Deck, MapView, ScatterplotLayer}] = await Promise.all([
    import("@afbin/apollo"),
    import("@afbin/deck-gl")
  ]);
  client = apollo;
  viewQuery = gql`{mapView {longitude latitude zoom pitch bearing}}`;
  const {data} = await client.query({query: viewQuery});
  latestViewState = data.mapView;

  const makeLayer = isDark => new ScatterplotLayer({
    id: "sample-points",
    data: points,
    getPosition: d => d.position,
    getRadius: d => d.value,
    getFillColor: isDark ? [120, 190, 255, 210] : [30, 100, 190, 210],
    radiusUnits: "pixels",
    radiusMinPixels: 4,
    pickable: true
  });

  host.style.background = dark() ? "#171923" : "#f5f7fa";
  deck = new Deck({
    parent: host,
    views: new MapView(),
    initialViewState: latestViewState,
    controller: true,
    layers: [makeLayer(dark())],
    getTooltip: ({object}) => object && `${object.name}: ${object.value}`,
    onViewStateChange: ({viewState}) => {
      latestViewState = viewState;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persistView, 180);
    },
    onError: () => showFallback()
  });
  resize = new ResizeObserver(() => deck.setProps({
    width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight)
  }));
  resize.observe(host);

  themeObserver = new MutationObserver(() => {
    host.style.background = dark() ? "#171923" : "#f5f7fa";
    deck.setProps({layers: [makeLayer(dark())]});
  });
  themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["data-af-dark"]});
} catch {
  showFallback();
}

function dispose() {
  if (disposed) return;
  disposed = true;
  resize?.disconnect();
  themeObserver?.disconnect();
  if (saveTimer !== undefined) persistView();
  deck?.finalize();
  window.removeEventListener("pagehide", dispose);
}
window.addEventListener("pagehide", dispose, {once: true});
</script>
```

## Theme, updates and lifetime

deck.gl does not infer the page's design-system colors. The example observes `data-af-dark`, updates concrete colors, and stores navigated view coordinates in each viewer's private Apollo local state. For data changes, construct updated layers and call `deck.setProps({layers: [...]})`; preserve the view state if the user has navigated. Disconnect observers and call `deck.finalize()` when replacing or disposing the map. If WebGL is unavailable, the live status message points to the equivalent table.

Set a nonzero height on the host. Observe its actual box so maps resize when a panel or viewport changes. Keep controls and a short text/table alternative outside the canvas for essential values and actions; do not make hover the only way to inspect data.

## Data and network limits

The module and its included layer packages are pinned and packaged with an admitted native page dependency. The example above is self-contained and works without network access. It does not include a basemap provider or tile service. Add a basemap only when you have selected and disclosed its provider, network requirements and applicable terms. External tiles and remote data can fail or be unavailable offline. For application data, use the authorized dataset/backend APIs described in [HTML runtime](runtime.md) and pass the returned rows into deck.gl; do not put account credentials in URLs or page code.

The legacy `<af-deck-gl>` element remains available for existing pages. New native HTML pages should use this direct API.

## API reference

- [deck.gl documentation and API reference](https://deck.gl/)
