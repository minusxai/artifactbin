import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthorComponentLifetime } from "../src/migration/conversion/compiled/author/component-lifetime.ts";
function owners() {
  type Owner = { cleanups: (() => void)[] };
  let current: Owner | null = null;
  const run = <T>(owner: Owner, callback: () => T): T => {
    const previous = current;
    current = owner;
    try {
      return callback();
    } finally {
      current = previous;
    }
  };
  return {
    make: (): Owner => ({ cleanups: [] }),
    run,
    current: () => current,
    cleanup: (owner: Owner, dispose: () => void) => {
      owner.cleanups.push(dispose);
    },
    remove: (owner: Owner) => {
      for (const cleanup of owner.cleanups.splice(0)) cleanup();
    },
  };
}
test("component listeners retain first native registration owner and can re-register after removal", () => {
  const port = owners(),
    a = port.make(),
    b = port.make(),
    life = createAuthorComponentLifetime(port),
    target = new EventTarget();
  let calls = 0;
  const shared = () => calls++;
  port.run(a, () => life.listen(target, "change", shared));
  port.run(b, () => life.listen(target, "change", shared));
  target.dispatchEvent(new Event("change"));
  assert.equal(calls, 1);
  port.remove(a);
  target.dispatchEvent(new Event("change"));
  assert.equal(calls, 1);
  port.run(b, () => life.listen(target, "change", shared));
  target.dispatchEvent(new Event("change"));
  assert.equal(calls, 2);
  port.remove(b);
  target.dispatchEvent(new Event("change"));
  assert.equal(calls, 2);
});
test("captured delegated callbacks restore owners and cannot run or register after removal", () => {
  const port = owners(),
    owner = port.make(),
    life = createAuthorComponentLifetime(port),
    target = new EventTarget();
  let calls = 0;
  const callback = port.run(owner, () =>
    life.callback(() => {
      assert.equal(port.current(), owner);
      life.listen(target, "change", () => calls++);
    }),
  );
  callback();
  target.dispatchEvent(new Event("change"));
  assert.equal(calls, 1);
  port.remove(owner);
  callback();
  target.dispatchEvent(new Event("change"));
  assert.equal(calls, 1);
  assert.throws(
    () => port.run(owner, () => life.listen(target, "change", () => {})),
    /disposed/,
  );
});
test("once, abort, cross-owner explicit removal and independent factories retain native identity", () => {
  const port = owners(),
    a = port.make(),
    b = port.make(),
    one = createAuthorComponentLifetime(port),
    two = createAuthorComponentLifetime(port),
    target = new EventTarget(),
    abort = new AbortController();
  let calls = 0;
  const shared = () => calls++;
  port.run(a, () => {
    one.listen(target, "change", shared, { once: true });
    two.listen(target, "change", shared, { signal: abort.signal });
  });
  target.dispatchEvent(new Event("change"));
  assert.equal(calls, 2);
  port.run(b, () => one.listen(target, "change", shared));
  abort.abort();
  target.dispatchEvent(new Event("change"));
  assert.equal(calls, 3);
  port.run(a, () => one.unlisten(target, "change", shared));
  target.dispatchEvent(new Event("change"));
  assert.equal(calls, 3);
  one.dispose();
  two.dispose();
});
test("disposal is inactive before retirement and drains all registrations despite host failures", () => {
  const port = owners(),
    a = port.make(),
    b = port.make(),
    life = createAuthorComponentLifetime(port);
  let removed = 0;
  class Target extends EventTarget {
    override removeEventListener(
      ...args: Parameters<EventTarget["removeEventListener"]>
    ) {
      super.removeEventListener(...args);
      removed++;
      if (removed === 1) throw Error("host");
    }
  }
  const target = new Target();
  port.run(a, () => life.listen(target, "a", () => {}));
  port.run(b, () => life.listen(target, "b", () => {}));
  assert.throws(() => life.dispose(), AggregateError);
  assert.equal(removed, 2);
  assert.equal(life.active, false);
  assert.throws(
    () => port.run(a, () => life.listen(target, "c", () => {})),
    /disposed/,
  );
});
