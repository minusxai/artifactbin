import { afterEach, expect, it, vi } from "vitest";
import { createDragPreview, type DragPreview } from "../drag-preview";
let preview: DragPreview;
afterEach(() => {
  preview?.dispose();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
const rect = (top: number, height = 40) => () => new DOMRect(20, top, 300, height);
const label = () => document.querySelector<HTMLElement>("[data-mx-drag-preview]")!;
const marker = () => document.querySelector<HTMLElement>("[data-mx-drop-marker]")!;
const cursorRule = () => [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
function fixture() {
  document.body.innerHTML =
    '<div data-mx-ast="0"><p data-mx-ast="0.0" id="source">Move me</p><p data-mx-ast="0.1" id="target">Destination</p><div data-mx-ast="0.2" id="box"><p data-mx-ast="0.2.0" id="nested">Nested</p></div></div><p data-mx-ast="1" id="outside">Other parent</p>';
  const source = document.getElementById("source")!;
  const target = document.getElementById("target")!;
  source.getBoundingClientRect = rect(40);
  target.getBoundingClientRect = rect(100);
  document.getElementById("box")!.getBoundingClientRect = rect(200, 60);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => target),
  });
  preview = createDragPreview(document);
  preview.start(source, "0.0", { label: "Paragraph", parent: "Card" });
  return { source, target };
}
it("names the dragged block beside the pointer and draws the insertion edge of a valid slot", () => {
  const { source } = fixture();
  expect(preview.update(30, 110)).toBe("0.1");
  expect(label().textContent).toBe("⠿ Paragraph");
  expect(label().getAttribute("data-mx-drop-state")).toBe("valid");
  expect(marker().style.display).toBe("block");
  expect(marker().style.top).toBe("140px");
  expect(document.querySelectorAll("#source")).toHaveLength(1);
  expect(source.getAttribute("style")).toBeNull();
});
it("is neutral over the source itself: no line, no red, no change", () => {
  const { source } = fixture();
  vi.mocked(document.elementFromPoint).mockReturnValue(source);
  expect(preview.update(30, 50)).toBeUndefined();
  expect(label().getAttribute("data-mx-drop-state")).toBe("none");
  expect(label().textContent).toBe("⠿ Paragraph");
  expect(marker().style.display).toBe("none");
  expect(cursorRule()).not.toMatch(/not-allowed/);
});
it("snaps to the nearest sibling slot when the pointer leaves the parent", () => {
  fixture();
  for (const hit of [document.getElementById("outside"), null]) {
    vi.mocked(document.elementFromPoint).mockReturnValue(hit);
    expect(preview.update(30, 320)).toBe("0.2");
    expect(label().getAttribute("data-mx-drop-state")).toBe("valid");
    expect(marker().style.display).toBe("block");
    // Nearest is the source itself: that is no move at all.
    expect(preview.update(30, 0)).toBeUndefined();
    expect(label().getAttribute("data-mx-drop-state")).toBe("none");
    expect(marker().style.display).toBe("none");
  }
});
it("resolves a hit on a nested node to the sibling that contains it", () => {
  fixture();
  vi.mocked(document.elementFromPoint).mockReturnValue(document.getElementById("nested"));
  expect(preview.update(30, 210)).toBe("0.2");
  preview.clear();
  expect(label().style.display).toBe("none");
});
it("explains, in red, a block that has nowhere to go", () => {
  document.body.innerHTML = '<div data-mx-ast="0"><p data-mx-ast="0.0" id="only">Alone</p></div><p data-mx-ast="1">Elsewhere</p>';
  const only = document.getElementById("only")!;
  only.getBoundingClientRect = rect(40);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => document.querySelector('[data-mx-ast="1"]')) });
  preview = createDragPreview(document);
  preview.start(only, "0.0", { label: "Paragraph", parent: "Card" });
  expect(preview.update(30, 300)).toBeUndefined();
  expect(label().getAttribute("data-mx-drop-state")).toBe("invalid");
  expect(label().textContent).toBe("Can only move within this card");
  expect(marker().style.display).toBe("none");
  expect(cursorRule()).toMatch(/not-allowed/);
  preview.clear();
  expect(cursorRule()).not.toMatch(/not-allowed/);
});
