// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { AfIsometric, registerIsometric } from "./isometric";
import { advanceIsometric } from "./isometric-model";
registerIsometric();
afterEach(() => document.body.replaceChildren());
it("retains keyed SVG parts across pose updates and preserves authored identities", () => {
  const element = document.createElement("af-isometric") as AfIsometric;
  element.innerHTML = '<span data-af-id="authored">Caption</span>';
  element.options = {
    title: "Assembly",
    parts: [
      {
        key: "body",
        kind: "slab",
        x: 0,
        y: 0,
        z: 0,
        width: 10,
        depth: 10,
        height: 2,
        separation: [0, 0, 10],
      },
    ],
  };
  document.body.append(element);
  const part = element.querySelector('[data-part="body"]');
  expect(part).not.toBeNull();
  element.options = { ...element.options!, spread: 1 };
  expect(element.querySelector('[data-part="body"]')).toBe(part);
  expect(part?.getAttribute("transform")).not.toBe("translate(0 0)");
  expect(element.querySelector('[data-af-id="authored"]')?.textContent).toBe(
    "Caption",
  );
  expect(element.querySelector("svg")?.getAttribute("aria-label")).toBe(
    "Assembly",
  );
});
it("uses bounded elapsed time for smoothing and snaps instant updates", () => {
  const target = { spread: 1, angle: 90 };
  expect(advanceIsometric({ spread: 0, angle: 0 }, target, 100, true)).toEqual(
    advanceIsometric({ spread: 0, angle: 0 }, target, 0.05, true),
  );
  expect(advanceIsometric({ spread: 0, angle: 0 }, target, 0.01, false)).toBe(
    target,
  );
});
it("stops motion while reduced or offscreen and cancels pending work on removal", () => {
  const element = document.createElement("af-isometric") as AfIsometric;
  const requested: number[] = [];
  const cancelled: number[] = [];
  let next = 0;
  const request = window.requestAnimationFrame;
  const cancel = window.cancelAnimationFrame;
  const media = window.matchMedia;
  const intersection = window.IntersectionObserver;
  let reduced = false;
  let mediaChange: () => void = () => {};
  let visibility: (entries: { isIntersecting: boolean }[]) => void = () => {};
  let disconnected = false;
  window.requestAnimationFrame = () => {
    requested.push(++next);
    return next;
  };
  window.cancelAnimationFrame = (id) => {
    cancelled.push(id);
  };
  window.matchMedia = (() => ({
    get matches() {
      return reduced;
    },
    addEventListener(_name: string, fn: () => void) {
      mediaChange = fn;
    },
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  window.IntersectionObserver = class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      visibility = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  } as unknown as typeof IntersectionObserver;
  try {
    element.options = {
      title: "Flow",
      flow: true,
      parts: [
        {
          key: "line",
          kind: "line",
          points: [
            [0, 0, 0],
            [10, 0, 0],
          ],
          dashed: true,
        },
      ],
    };
    document.body.append(element);
    expect(requested).toHaveLength(1);
    reduced = true;
    mediaChange();
    expect(cancelled).toEqual([1]);
    reduced = false;
    mediaChange();
    expect(requested).toHaveLength(2);
    visibility([{ isIntersecting: false }]);
    expect(cancelled).toEqual([1, 2]);
    visibility([{ isIntersecting: true }]);
    element.remove();
    expect(cancelled).toEqual([1, 2, 3]);
    expect(disconnected).toBe(true);
  } finally {
    element.remove();
    window.requestAnimationFrame = request;
    window.cancelAnimationFrame = cancel;
    window.matchMedia = media;
    window.IntersectionObserver = intersection;
  }
});
