import { describe, expect, it } from "vitest";
import {
  beginGesture,
  moveGesture,
  paperContains,
  releaseGesture,
  scenePoint,
} from "../paper-model";

describe("paper gestures in source-image coordinates", () => {
  it("registers a pointer to the same place after resizing and page offsets", () => {
    expect(
      scenePoint(
        { x: 382, y: 321.5 },
        { left: 20, top: 50, width: 724, height: 543 },
      ),
    ).toEqual({ x: 724, y: 543 });
  });
  it("opens a short click, returns a small drag and detaches a deliberate pull", () => {
    const start = beginGesture("real-artifact", { x: 10, y: 10 });
    expect(releaseGesture(moveGesture(start, { x: 12, y: 13 }))).toEqual({
      kind: "open",
      id: "real-artifact",
    });
    expect(releaseGesture(moveGesture(start, { x: 30, y: 40 })).kind).toBe(
      "return",
    );
    expect(releaseGesture(moveGesture(start, { x: 80, y: 120 })).kind).toBe(
      "detach",
    );
  });
  it("never opens a page after dragging away and back or on pointer cancellation", () => {
    const start = beginGesture("example", { x: 0, y: 0 });
    const moved = moveGesture(moveGesture(start, { x: 120, y: 100 }), {
      x: 0,
      y: 0,
    });
    expect(releaseGesture(moved).kind).toBe("return");
    expect(releaseGesture(start, true).kind).toBe("return");
    expect(
      releaseGesture(moveGesture(start, { x: 120, y: 100 }), true).kind,
    ).toBe("return");
  });
  it("hit-tests a rotated page, not its enclosing rectangle", () => {
    const slot = {
      id: "page",
      x: 100,
      y: 100,
      width: 100,
      height: 200,
      angle: Math.PI / 2,
    };
    expect(paperContains(slot, { x: 10, y: 150 })).toBe(true);
    expect(paperContains(slot, { x: 190, y: 290 })).toBe(false);
  });
});
