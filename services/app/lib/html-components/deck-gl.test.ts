import { expect, it } from "vitest";
import { DeckGeneration, DeckViewModel } from "./deck-gl-model";
const view = { longitude: 0, latitude: 0, zoom: 1, pitch: 0, bearing: 0 };
it("fits until reader gesture and resumes after reset", () => {
  const model = new DeckViewModel(view);
  const fit = { ...view, zoom: 5 };
  model.move({ ...view, zoom: 2 }, false);
  model.fit(fit);
  expect(model.view).toBe(fit);
  model.move({ ...view, zoom: 3 }, true);
  model.fit(view);
  expect(model.view.zoom).toBe(3);
  model.reset(fit);
  model.fit(view);
  expect(model.view).toBe(view);
});
it("invalidates stale async mounts on replacement and disposal", () => {
  const generations = new DeckGeneration();
  const old = generations.next();
  const fresh = generations.next();
  expect(old()).toBe(false);
  expect(fresh()).toBe(true);
  generations.invalidate();
  expect(fresh()).toBe(false);
});
