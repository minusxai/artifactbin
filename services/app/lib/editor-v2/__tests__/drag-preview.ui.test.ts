import { afterEach, expect, it, vi } from "vitest";
import { createDragPreview, type DragPreview } from "../drag-preview";
let preview: DragPreview;
afterEach(() => {
  preview?.dispose();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
function fixture() {
  document.body.innerHTML =
    '<div data-mx-ast="0"><p data-mx-ast="0.0" id="source">Move me</p><p data-mx-ast="0.1" id="target">Destination</p><div data-mx-ast="0.2"><p data-mx-ast="0.2.0" id="nested">Nested</p></div></div><p data-mx-ast="1" id="outside">Other parent</p>';
  const source = document.getElementById("source")!;
  const target = document.getElementById("target")!;
  target.getBoundingClientRect = () => ({
    left: 20,
    top: 100,
    right: 320,
    bottom: 140,
    width: 300,
    height: 40,
    x: 20,
    y: 100,
    toJSON: () => ({}),
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => target),
  });
  preview = createDragPreview(document);
  preview.start(source, "0.0");
  return { source, target };
}
it("shows a text-only shadow preview and the actual insertion edge before committing", () => {
  const { source, target } = fixture();
  expect(preview.update(30, 110)).toBe("0.1");
  expect(
    document.querySelector("[data-mx-drag-preview]")?.textContent,
  ).toContain("Move me");
  expect(
    document.querySelector("[data-mx-drag-preview]")?.textContent,
  ).toBe("Move me");
  expect(
    document.querySelector<HTMLElement>("[data-mx-drop-marker]")!.style.top,
  ).toBe("140px");
  expect(document.querySelectorAll("#source")).toHaveLength(1);
  expect(source.getAttribute("style")).toBeNull();
  preview.start(target, "0.1");
  vi.mocked(document.elementFromPoint).mockReturnValue(source);
  expect(preview.update(30, 20)).toBe("0.0");
  expect(
    document.querySelector("[data-mx-drag-preview]")?.textContent,
  ).toBe("Destination");
});
it("rejects self and other parents, and resolves nested hits to the sibling container", () => {
  const { source } = fixture();
  for (const hit of [source, document.getElementById("outside"), null]) {
    vi.mocked(document.elementFromPoint).mockReturnValue(hit);
    expect(preview.update(30, 110)).toBeUndefined();
    expect(
      document.querySelector("[data-mx-drag-preview]")?.textContent,
    ).toBe("Move me");
    expect(
      document.querySelector<HTMLElement>("[data-mx-drop-marker]")!.style
        .display,
    ).toBe("none");
  }
  vi.mocked(document.elementFromPoint).mockReturnValue(
    document.getElementById("nested"),
  );
  expect(preview.update(30, 110)).toBe("0.2");
  preview.clear();
  expect(
    document.querySelector<HTMLElement>("[data-mx-drag-preview]")!.style
      .display,
  ).toBe("none");
});
