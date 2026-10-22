import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthorWindowFacade } from "../src/migration/conversion/compiled/author/window.ts";
import { createAuthorEffectLifetime } from "../src/migration/conversion/compiled/author/lifecycle.ts";
import type { AuthorWindowPort } from "../src/migration/conversion/compiled/author/window-contracts.ts";
function fixture() {
  const media = Object.assign(new EventTarget(), {
    media: "(min-width: 1px)",
    matches: true,
  });
  const port = Object.assign(new EventTarget(), {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 2,
    scrollX: 0,
    scrollY: 20,
    matchMedia: () => media,
  }) as AuthorWindowPort;
  const life = createAuthorEffectLifetime({
    timeout: () => 1,
    interval: () => 2,
    frame: () => 3,
    clearTimeout() {},
    clearInterval() {},
    cancelFrame() {},
  });
  return { port, media, life, facade: createAuthorWindowFacade(port, life) };
}
test("window callbacks receive frozen primitive projections and retain listener removal identity", () => {
  const { port, life, facade } = fixture();
  let event: any,
    calls = 0;
  const fn = (e: unknown) => {
    event = e;
    calls++;
  };
  facade.addEventListener("scroll", fn);
  const native = Object.assign(new Event("scroll"), { view: port });
  port.dispatchEvent(native);
  assert.equal(calls, 1);
  assert.equal(Object.getPrototypeOf(event), null);
  assert(Object.isFrozen(event));
  assert(!("view" in event));
  assert(!("target" in event));
  assert(!("composedPath" in event));
  facade.removeEventListener("scroll", fn);
  port.dispatchEvent(native);
  assert.equal(calls, 1);
  assert.equal(Object.getPrototypeOf(facade), null);
  assert(Object.isFrozen(facade));
  assert.throws(() => facade.addEventListener("message", fn));
  life.dispose();
});
test("media wrapper exposes no native target and all callbacks stop on disposal", () => {
  const { media, life, facade } = fixture();
  const query = facade.matchMedia("(min-width: 1px)");
  let event: any,
    calls = 0;
  query.addEventListener("change", (e) => {
    event = e;
    calls++;
  });
  media.dispatchEvent(new Event("change"));
  assert.equal(calls, 1);
  assert.equal(event.matches, true);
  assert.equal(Object.getPrototypeOf(query), null);
  assert(Object.isFrozen(query));
  assert(!("dispatchEvent" in query));
  assert(!("target" in event));
  life.dispose();
  media.dispatchEvent(new Event("change"));
  assert.equal(calls, 1);
  assert.throws(() => facade.matchMedia("x".repeat(513)));
});
