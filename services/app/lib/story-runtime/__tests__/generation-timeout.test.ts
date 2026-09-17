import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { AUTHOR_SCRIPT_BOOTSTRAP } from "../author-script-bootstrap";
afterEach(() => vi.useRealTimers());

it("keeps an author mutation pending past the ordinary script timeout", async () => {
  vi.useFakeTimers();
  const listeners: Record<string, Function> = {};
  const sent: Array<{ id: number }> = [];
  const port = {
    start() {},
    postMessage: (message: { id: number }) => sent.push(message),
    onmessage: null as null | ((event: { data: unknown }) => Promise<void>),
  };
  const parent = {};
  const realm: any = {
    parent,
    addEventListener: (name: string, fn: Function) => {
      listeners[name] = fn;
    },
    setTimeout,
    clearTimeout,
    structuredClone,
    console,
  };
  realm.window = realm;
  runInNewContext(AUTHOR_SCRIPT_BOOTSTRAP, realm);
  listeners.message({ source: parent, data: "mx:author:init", ports: [port] });
  let settled = false;
  const result = realm.mx.mutate("step").then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await vi.advanceTimersByTimeAsync(21_000);
  expect(settled).toBe(false);
  await port.onmessage!({ data: { id: sent[0].id, ok: true } });
  await result;
  expect(settled).toBe(true);
});
