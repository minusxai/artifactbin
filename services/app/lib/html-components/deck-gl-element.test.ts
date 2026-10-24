// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
const adapter = vi.hoisted(() => ({ update: vi.fn(), dispose: vi.fn() }));
const mount = vi.hoisted(() => vi.fn(() => adapter));
vi.mock("./deck-gl-engine", () => ({ mountDeckGL: mount }));
import { AfDeckGL, registerDeckGL } from "./deck-gl";
registerDeckGL();
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
it("keeps data author owned and updates mounted adapter without replacing authored children", async () => {
  const element = document.createElement("af-deck-gl") as AfDeckGL;
  element.innerHTML = '<span data-af-id="caption">Caption</span>';
  element.options = { data: [{ x: 1 }], layers: [], basemap: "none" };
  document.body.append(element);
  await flush();
  expect(mount).toHaveBeenCalledTimes(1);
  element.options = { ...element.options!, data: [{ x: 2 }] };
  expect(adapter.update).toHaveBeenCalledWith(element.options);
  expect(element.querySelector("[data-af-id=caption]")?.textContent).toBe(
    "Caption",
  );
  element.remove();
  expect(adapter.dispose).toHaveBeenCalledTimes(1);
});
it("never mounts a stale async engine after disconnect", async () => {
  const element = document.createElement("af-deck-gl") as AfDeckGL;
  element.options = { data: [], layers: [] };
  document.body.append(element);
  element.remove();
  await flush();
  expect(mount).not.toHaveBeenCalled();
});
it("rejects network layer sources before calling the engine", () => {
  const element = document.createElement("af-deck-gl") as AfDeckGL;
  expect(() => {
    element.options = {
      data: [],
      layers: [
        { "@@type": "ScatterplotLayer", data: "https://example.com/private" },
      ],
    };
  }).toThrow();
  expect(mount).not.toHaveBeenCalled();
});
