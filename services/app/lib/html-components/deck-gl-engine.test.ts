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
  document.body.removeAttribute("style");
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
it("renders compact map controls and a labeled gradient legend", () => {
  const host = document.createElement("af-deck-gl");
  host.style.setProperty("--radius-md", "14px");
  host.style.setProperty("--radius-sm", "6px");
  document.body.style.fontFamily = "monospace";
  document.body.append(host);
  mountDeckGL(host, {
    data: [
      { longitude: 10, latitude: 20, value: 12 },
      { longitude: 11, latitude: 21, value: 20 },
    ],
    layers: [
      {
        "@@type": "ScatterplotLayer",
        getPosition: "@@=[longitude, latitude]",
        getRadius: 20_000,
        getFillColor: "@@=ramp(value)",
      },
    ],
    basemap: "none",
    legend: true,
  });

  const controls = host.querySelector('[data-af-deck-controls][role="group"][aria-label="Map controls"]');
  expect(controls?.querySelectorAll("button")).toHaveLength(3);
  expect(Array.from(controls?.querySelectorAll("button") ?? []).map((button) => button.getAttribute("aria-label"))).toEqual([
    "Zoom in",
    "Zoom out",
    "Reset view",
  ]);
  expect(controls?.querySelectorAll("button svg[aria-hidden='true']")).toHaveLength(3);
  const controlStyle = getComputedStyle(controls!);
  expect(controlStyle.position).toBe("absolute");
  expect(controlStyle.top).toBe("8px");
  expect(controlStyle.right).toBe("8px");
  expect(controlStyle.flexDirection).toBe("column");

  const legend = host.querySelector('[data-af-deck-legend][role="group"][aria-label="Map legend"]');
  expect(legend?.textContent).toContain("value");
  expect(legend?.textContent).toContain("12");
  expect(legend?.textContent).toContain("20");
  expect(legend?.querySelector('[role="img"][aria-label="value: 12 to 20"]')).not.toBeNull();
  const legendStyle = getComputedStyle(legend!);
  expect(legendStyle.position).toBe("absolute");
  expect(legendStyle.bottom).toBe("20px");
  expect(legendStyle.left).toBe("8px");
  const bar = legend?.querySelector('[role="img"]') as HTMLElement | null;
  expect(bar?.style.background).toContain("linear-gradient");
  expect(getComputedStyle(bar!).height).toBe("8px");
  expect(getComputedStyle(bar!).width).toBe("96px");

  const chromeCss = host.querySelector('figure[part="map"] style')?.textContent ?? "";
  expect(host.style.getPropertyValue("--radius-md")).toBe("14px");
  expect(host.style.getPropertyValue("--radius-sm")).toBe("6px");
  expect(chromeCss).toContain("border-radius:var(--radius-md,calc(var(--radius,.625rem) - .125rem))");
  expect(chromeCss).toContain("border-radius:var(--radius-sm,calc(var(--radius,.625rem) - .25rem))");
  expect(chromeCss).toContain("font-family:inherit");
  expect(chromeCss).not.toContain("var(--font-body");

  const unrelated = document.createElement("figure");
  unrelated.setAttribute("part", "map");
  const unrelatedControls = document.createElement("div");
  unrelatedControls.setAttribute("data-af-deck-controls", "");
  unrelated.append(unrelatedControls);
  document.body.append(unrelated);
  expect(getComputedStyle(unrelatedControls).position).toBe("static");
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
