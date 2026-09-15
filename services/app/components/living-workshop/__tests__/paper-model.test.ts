import { expect, it } from "vitest";
import { beginGesture, moveGesture, scenePoint } from "../paper-model";

it("maps a pointer after resizing and page offsets", () => {
  expect(scenePoint({ x: 382, y: 253.75 }, { left: 20, top: 50, width: 724, height: 407.5 }))
    .toEqual({ x: 724, y: 407.5 });
});
it("distinguishes a click from a drag and remembers a drag that returns to its origin", () => {
  const start = beginGesture("example", { x: 10, y: 10 });
  expect(moveGesture(start, { x: 12, y: 13 }).dragging).toBe(false);
  const dragged = moveGesture(start, { x: 120, y: 100 });
  expect(dragged).toMatchObject({ id: "example", current: { x: 120, y: 100 }, dragging: true });
  expect(moveGesture(dragged, start.origin).dragging).toBe(true);
});
