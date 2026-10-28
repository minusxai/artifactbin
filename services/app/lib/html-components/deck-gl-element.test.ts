// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
const adapter = vi.hoisted(() => ({ update: vi.fn(), dispose: vi.fn() }));
const mount = vi.hoisted(() => vi.fn(() => adapter));
vi.mock("./deck-gl-engine", () => ({ mountDeckGL: mount }));
import { AfDeckGL } from "./deck-gl";
import './deck-gl';
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
  expect(adapter.update).toHaveBeenCalledWith({
    ...element.options,
    colorMode: "light",
  });
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
it("follows live ancestor themes without options changes and disconnects observation", async () => {
  const ancestor = document.createElement("section");
  const element = document.createElement("af-deck-gl") as AfDeckGL;
  ancestor.append(element);
  element.options = { data: [], layers: [], basemap: "auto" };
  document.body.append(ancestor);
  await flush();
  ancestor.setAttribute("data-af-dark", "true");
  await flush();
  expect(adapter.update).toHaveBeenLastCalledWith({
    ...element.options,
    colorMode: "dark",
  });
  ancestor.removeAttribute("data-af-dark");
  ancestor.setAttribute("data-af-design-system", "technical");
  await flush();
  expect(adapter.update).toHaveBeenLastCalledWith({
    ...element.options,
    colorMode: "light",
  });
  element.options = { ...element.options!, colorMode: "dark" };
  ancestor.removeAttribute("data-af-design-system");
  await flush();
  expect(adapter.update).toHaveBeenLastCalledWith(element.options);
  element.remove();
  adapter.update.mockClear();
  ancestor.setAttribute("data-af-dark", "true");
  await flush();
  expect(adapter.update).not.toHaveBeenCalled();
});
it("owns one load status and clears it on retry success or options removal", async () => {
  const element = document.createElement("af-deck-gl") as AfDeckGL;
  element.innerHTML =
    '<p role="status" data-af-id="authored">Author status</p>';
  mount.mockImplementationOnce(() => {
    throw new Error("Unavailable");
  });
  element.options = { data: [], layers: [] };
  document.body.append(element);
  await flush();
  expect(element.querySelectorAll("[role=status]")).toHaveLength(2);
  element.options = { data: [], layers: [] };
  await flush();
  expect(element.querySelectorAll("[role=status]")).toHaveLength(1);
  expect(element.querySelector("[data-af-id=authored]")).not.toBeNull();
  element.options = undefined;
  mount.mockImplementationOnce(() => {
    throw new Error("Again");
  });
  element.options = { data: [], layers: [] };
  await flush();
  expect(element.querySelectorAll("[role=status]")).toHaveLength(2);
  element.options = undefined;
  expect(element.querySelectorAll("[role=status]")).toHaveLength(1);
});
it("uses exact authored true/false theme values and respects nearer light overrides", async () => {
  const outer = document.createElement("section");
  const inner = document.createElement("section");
  const element = document.createElement("af-deck-gl") as AfDeckGL;
  outer.append(inner);
  inner.append(element);
  element.options = { data: [], layers: [] };
  document.body.append(outer);
  await flush();
  expect(mount).toHaveBeenLastCalledWith(element, {
    ...element.options,
    colorMode: "light",
  });
  outer.setAttribute("data-af-dark", "false");
  await flush();
  expect(adapter.update).toHaveBeenLastCalledWith({
    ...element.options,
    colorMode: "light",
  });
  outer.setAttribute("data-af-dark", "true");
  await flush();
  expect(adapter.update).toHaveBeenLastCalledWith({
    ...element.options,
    colorMode: "dark",
  });
  inner.setAttribute("data-af-dark", "false");
  await flush();
  expect(adapter.update).toHaveBeenLastCalledWith({
    ...element.options,
    colorMode: "light",
  });
  inner.removeAttribute("data-af-dark");
  await flush();
  expect(adapter.update).toHaveBeenLastCalledWith({
    ...element.options,
    colorMode: "dark",
  });
  outer.removeAttribute("data-af-dark");
  await flush();
  expect(adapter.update).toHaveBeenLastCalledWith({
    ...element.options,
    colorMode: "light",
  });
});
