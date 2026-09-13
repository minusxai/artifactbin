import { afterEach, expect, it, vi } from "vitest";
import { showcaseImage } from "../showcase-image";
import { SHOWCASE, showcaseCardUrl } from "../showcase";
afterEach(() => vi.unstubAllGlobals());
it("does not fetch arbitrary ids", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await showcaseImage("not-curated")).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
it("fetches only a canonical public capture without credentials or redirects", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(new Uint8Array([255, 216, 255]), {
        headers: { "Content-Type": "image/jpeg" },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  const r = await showcaseImage(SHOWCASE[0].id);
  expect(r.status).toBe(200);
  expect(fetch.mock.calls[0][0]).toBe(showcaseCardUrl(SHOWCASE[0]));
  expect(fetch.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    credentials: "omit",
  });
  expect(r.headers.get("Content-Type")).toBe("image/jpeg");
});
it("does not relay error bodies or non-images", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("secret upstream diagnostic", { status: 403 }),
      ),
  );
  const r = await showcaseImage(SHOWCASE[0].id);
  expect(r.status).toBe(502);
  expect(await r.text()).not.toContain("secret");
});
