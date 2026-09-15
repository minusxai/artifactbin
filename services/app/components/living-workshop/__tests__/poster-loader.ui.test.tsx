import { afterEach, expect, it, vi } from "vitest";
import { createPosterLoader } from "../poster-loader";

afterEach(() => vi.useRealTimers());

it("leaves connections available for scene assets and starts the next poster when one settles", () => {
  const loader = createPosterLoader();
  const images = Array.from({ length: 3 }, () => new Image());
  images.forEach((image, i) => loader.load(image, `/poster-${i}.jpg`));
  expect(images.map(image => image.getAttribute("src"))).toEqual(["/poster-0.jpg", "/poster-1.jpg", null]);
  images[0]!.dispatchEvent(new Event("load"));
  expect(images[2]!.getAttribute("src")).toBe("/poster-2.jpg");
  loader.dispose();
});

it("gives each active poster 50 seconds without charging queued time", () => {
  vi.useFakeTimers();
  const loader = createPosterLoader();
  const images = Array.from({ length: 6 }, () => new Image());
  const failed = vi.fn();
  images.forEach((image, i) => { image.onerror = failed; loader.load(image, `/poster-${i}.jpg`); });
  vi.advanceTimersByTime(49_999);
  expect(failed).not.toHaveBeenCalled();
  expect(images[0]!.getAttribute("src")).toBe("/poster-0.jpg");
  expect(images[2]!.hasAttribute("src")).toBe(false);
  vi.advanceTimersByTime(1);
  expect(failed).toHaveBeenCalledTimes(2);
  expect(images[2]!.getAttribute("src")).toBe("/poster-2.jpg");
  vi.advanceTimersByTime(49_999);
  expect(failed).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(50_001);
  expect(failed).toHaveBeenCalledTimes(6);
  expect(images.every(image => !image.hasAttribute("src"))).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  loader.dispose();
});

it("cancels work on unmount without callbacks or starting queued requests", () => {
  vi.useFakeTimers();
  const loader = createPosterLoader();
  const images = Array.from({ length: 3 }, () => new Image());
  const failed = vi.fn();
  images.forEach((image, i) => { image.onerror = failed; loader.load(image, `/poster-${i}.jpg`); });
  loader.dispose();
  images[0]!.dispatchEvent(new Event("load"));
  vi.runAllTimers();
  expect(failed).not.toHaveBeenCalled();
  expect(images.every(image => !image.hasAttribute("src"))).toBe(true);
});
