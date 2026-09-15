import { expect, it } from "vitest";
import { applyForegroundMask } from "../foreground-mask";

it("uses red coverage for the cutout, preserving source color and soft edges", () => {
  const pixels = new Uint8ClampedArray([
    20, 30, 40, 255, 50, 60, 70, 255, 80, 90, 100, 255,
  ]);
  applyForegroundMask(
    pixels,
    new Uint8ClampedArray([0, 0, 0, 255, 255, 0, 0, 255, 128, 0, 0, 255]),
  );
  expect([...pixels]).toEqual([
    20, 30, 40, 0, 50, 60, 70, 255, 80, 90, 100, 128,
  ]);
});
