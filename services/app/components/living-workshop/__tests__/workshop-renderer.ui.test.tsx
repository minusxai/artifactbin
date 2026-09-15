import { afterEach, expect, it, vi } from "vitest";
import { createWorkshopScene } from "../workshop-renderer";
import { WORKSHOP_PAPERS, WORKSHOP_SETTINGS } from "../scene-manifest";

vi.mock("three", async (importOriginal) => ({
  ...await importOriginal<typeof import("three")>(),
  WebGLRenderer: class { setClearColor() {} },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([false, true])("requests canvas posters in anonymous CORS mode before loading (DEV=%s)", (dev) => {
  vi.stubEnv("DEV", dev);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  // No GPU or pixel simulation: intercept the real renderer's image request boundary.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const stop = new Error("image request observed");
  const requests: Array<{ src: string; crossOrigin: string | null }> = [];
  vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(function (this: HTMLImageElement, src: string) {
    requests.push({ src, crossOrigin: this.crossOrigin });
    throw stop;
  });
  const paper = WORKSHOP_PAPERS[0]!;
  expect(() => createWorkshopScene(document.createElement("canvas"), [paper], WORKSHOP_SETTINGS.indoor)).toThrow(stop);
  const preview = new URL(paper.image);
  expect(requests).toEqual([{
    src: dev ? `/__dev/showcase${preview.pathname}${preview.search}` : paper.image,
    crossOrigin: "anonymous",
  }]);
});
