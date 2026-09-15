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

it.each(["load", "error"])("paints a paper loading indicator only until image %s", (event) => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  const context = {
    clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(),
    lineTo: vi.fn(), closePath: vi.fn(), clip: vi.fn(), fillRect: vi.fn(),
    arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    rect: vi.fn(), drawImage: vi.fn(), putImageData: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
  const stop = new Error("image request observed");
  let image!: HTMLImageElement;
  vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(function (this: HTMLImageElement) {
    image = this;
    throw stop;
  });
  expect(() => createWorkshopScene(document.createElement("canvas"), [WORKSHOP_PAPERS[0]!], WORKSHOP_SETTINGS.indoor)).toThrow(stop);
  expect(context.stroke).toHaveBeenCalled();
  context.stroke.mockClear();
  if (event === "load") {
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 1 }, naturalHeight: { value: 1 } });
    image.onload!.call(image, new Event("load"));
    expect(context.drawImage).toHaveBeenCalled();
  } else {
    image.onerror!.call(image, new Event("error"));
  }
  expect(context.stroke).not.toHaveBeenCalled();
});
