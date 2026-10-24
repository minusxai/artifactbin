// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  deck: [] as {
    props: Record<string, unknown>;
    finalize: ReturnType<typeof vi.fn>;
    setProps: ReturnType<typeof vi.fn>;
  }[],
  maps: [] as {
    remove: ReturnType<typeof vi.fn>;
    jumpTo: ReturnType<typeof vi.fn>;
  }[],
  fail: false,
}));
vi.mock("@deck.gl/core", () => ({
  Deck: class {
    props: Record<string, unknown>;
    finalize = vi.fn();
    setProps = vi.fn((next) => Object.assign(this.props, next));
    constructor(props: Record<string, unknown>) {
      this.props = props;
      state.deck.push(this);
    }
  },
}));
vi.mock("@deck.gl/maplibre", () => ({
  MapLibreOverlay: class {
    setProps = vi.fn();
  },
}));
vi.mock("maplibre-gl", () => {
  class GPUInitializationError extends Error {}
  return {
    GPUInitializationError,
    Map: class {
      remove = vi.fn();
      jumpTo = vi.fn();
      constructor() {
        if (state.fail) throw new GPUInitializationError();
        state.maps.push(this);
      }
      addControl() {}
      on() {}
    },
  };
});
import { mountDeckGL, DECK_BASEMAP_UNAVAILABLE } from "./deck-gl-engine";
afterEach(() => {
  state.deck = [];
  state.maps = [];
  state.fail = false;
  document.body.replaceChildren();
});
it("renders offline deck layers, controls and reset without any basemap", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const engine = mountDeckGL(host, {
    data: [],
    layers: [],
    basemap: "none",
    title: "Locations",
    height: 320,
    initialViewState: { zoom: 4 },
  });
  expect(state.maps).toHaveLength(0);
  expect(state.deck).toHaveLength(1);
  expect(host.querySelector("figure")?.getAttribute("aria-label")).toBe(
    "Locations",
  );
  const buttons = host.querySelectorAll("button");
  buttons[0]!.click();
  expect((state.deck[0]!.props.viewState as { zoom: number }).zoom).toBe(5);
  engine.update({
    data: [],
    layers: [],
    basemap: "none",
    initialViewState: { zoom: 7 },
  });
  expect((state.deck[0]!.props.viewState as { zoom: number }).zoom).toBe(5);
  buttons[2]!.click();
  expect((state.deck[0]!.props.viewState as { zoom: number }).zoom).toBe(7);
  engine.dispose();
  engine.dispose();
  expect(state.deck[0]!.finalize).toHaveBeenCalledTimes(1);
  expect(host.children).toHaveLength(0);
});
it("keeps deck view with an accessible explanation when street WebGL2 is unavailable", () => {
  state.fail = true;
  const host = document.createElement("div");
  document.body.append(host);
  const engine = mountDeckGL(host, { data: [], layers: [], basemap: "light" });
  expect(host.textContent).toContain(DECK_BASEMAP_UNAVAILABLE);
  expect(state.deck).toHaveLength(1);
  engine.dispose();
});
