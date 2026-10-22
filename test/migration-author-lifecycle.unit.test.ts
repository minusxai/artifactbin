import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthorEffectLifetime } from "../src/migration/conversion/compiled/author/lifecycle.ts";
import type { AuthorLifetimeClock } from "../src/migration/conversion/compiled/author/lifecycle-contracts.ts";
function clock() {
  let id = 0;
  const callbacks = new Map<number, () => void>();
  const cleared: number[] = [];
  const put = (fn: () => void) => {
    callbacks.set(++id, fn);
    return id;
  };
  const clear = (key: number) => {
    cleared.push(key);
    callbacks.delete(key);
  };
  return {
    callbacks,
    cleared,
    port: {
      timeout: put,
      interval: put,
      frame: (fn: (time: number) => void) => put(() => fn(0)),
      clearTimeout: clear,
      clearInterval: clear,
      cancelFrame: clear,
    } as AuthorLifetimeClock,
  };
}
test("effect lifetimes own listener identity, once and capture semantics", () => {
  const c = clock(),
    life = createAuthorEffectLifetime(c.port),
    target = new EventTarget();
  let calls = 0;
  const listener = () => calls++;
  life.listen(target, "change", listener, { once: true, capture: true });
  life.listen(target, "change", listener, { capture: true });
  target.dispatchEvent(new Event("change"));
  target.dispatchEvent(new Event("change"));
  assert.equal(calls, 1);
  life.listen(target, "change", listener);
  life.unlisten(target, "change", listener, true);
  target.dispatchEvent(new Event("change"));
  assert.equal(calls, 2);
  life.unlisten(target, "change", listener, false);
  target.dispatchEvent(new Event("change"));
  assert.equal(calls, 2);
  life.dispose();
});
test("dispose suppresses late callbacks, drains throwing cleanup and cannot cancel another instance timers", () => {
  const c = clock(),
    a = createAuthorEffectLifetime(c.port),
    b = createAuthorEffectLifetime(c.port);
  let calls = 0;
  const key = b.timeout(() => calls++, 1);
  a.clearTimer(key);
  assert(c.callbacks.has(key));
  const late = a.timeout(() => {
    calls += 100;
    a.timeout(() => calls++, 0);
  }, 0);
  const callback = c.callbacks.get(late)!;
  a.own(() => {
    throw Error("cleanup");
  });
  let drained = false;
  a.own(() => {
    drained = true;
    assert.throws(() => a.timeout(() => {}, 0));
  });
  assert.throws(() => a.dispose(), AggregateError);
  assert(drained);
  callback();
  assert.equal(calls, 0);
  c.callbacks.get(key)!();
  assert.equal(calls, 1);
  b.dispose();
});
test("abort removal and object listeners preserve receiver and disposed registration is refused", () => {
  const c = clock(),
    life = createAuthorEffectLifetime(c.port),
    target = new EventTarget(),
    signal = new AbortController();
  const listener = {
    calls: 0,
    handleEvent() {
      this.calls++;
    },
  };
  life.listen(target, "change", listener, { signal: signal.signal });
  target.dispatchEvent(new Event("change"));
  assert.equal(listener.calls, 1);
  signal.abort();
  target.dispatchEvent(new Event("change"));
  assert.equal(listener.calls, 1);
  life.dispose();
  assert.throws(() => life.listen(target, "change", listener));
});
test("invalid string callbacks and timer delays refuse before scheduling", () => {
  const c = clock(),
    life = createAuthorEffectLifetime(c.port);
  assert.throws(() => life.timeout("code" as never));
  assert.throws(() => life.interval(() => {}, Infinity));
  assert.throws(() => life.frame("code" as never));
  assert.equal(c.callbacks.size, 0);
  life.dispose();
});
