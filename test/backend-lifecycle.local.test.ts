import test from "node:test";
import assert from "node:assert/strict";
import { createBackendHost } from "../src/backend/container-host.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("close cancels an entered compiler's package fetch and awaits its package client's close", async () => {
  const started = deferred(), cleanup = deferred();
  const external = new AbortController();
  let fetchSignal: AbortSignal | undefined;
  let fetching: Promise<unknown> = Promise.resolve();
  let closes = 0;
  const host = createBackendHost({
    sandboxNetwork: "none",
    fetchModule: Object.assign(async (_url: string, signal?: AbortSignal) => {
      fetchSignal = signal;
      started.resolve();
      fetching = new Promise<void>((_resolve, reject) => {
        signal!.addEventListener("abort", () => {
          void cleanup.promise.then(() => reject(Error("cancelled")));
        }, { once: true });
      });
      await fetching;
      throw Error("unreachable");
    }, {
      // Its own fetches drain before its close settles.
      close: () => { closes++; return fetching.then(() => {}, () => {}); },
    }),
  });
  const pending = host.compile("import { value } from 'probe@1.0.0'; export const typeDefs='type Query{value:String}'; export default{Query:{value:()=>value}};", external.signal);
  const rejected = assert.rejects(pending, /cancelled|build_rejected/);
  try {
    await started.promise;
    let closed = false;
    const closing = host.close!().then(() => { closed = true; });
    assert.equal(fetchSignal?.aborted, true, "the host cancels work before container admission");
    assert.equal(closes, 1, "the host closes the package client it owns");
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closed, false, "close waits for the package client's close");
    cleanup.resolve();
    await closing;
    await rejected;
    await assert.rejects(host.compile(""), /backend_unavailable/);
  } finally {
    external.abort();
    cleanup.resolve();
    await rejected;
    await host.close?.();
  }
});

test("a compile whose package fetch fulfils as the host closes never starts its next wave", async () => {
  const started = deferred();
  let finish!: (value: { url: string; code: string }) => void;
  let calls = 0;
  const host = createBackendHost({
    sandboxNetwork: "none",
    fetchModule: Object.assign(async (url: string) => {
      calls++;
      started.resolve();
      if (calls > 1) return { url, code: 'export const value = "unexpected";' };
      return new Promise<{ url: string; code: string }>(resolve => { finish = resolve; });
    }, { close: async () => {} }),
  });
  const pending = host.compile("import { value } from 'probe@1.0.0'; export const typeDefs='type Query{value:String}'; export default{Query:{value:()=>value}};");
  const rejected = assert.rejects(pending, /cancelled|backend_unavailable/);
  await started.promise;
  // Closed first, then the fetch fulfils: the compile resumes only into a closed host.
  const closing = host.close!();
  finish({ url: "https://esm.sh/probe@1.0.0", code: 'export { value } from "/next.mjs";' });
  await closing;
  await rejected;
  assert.equal(calls, 1, "a resumed compile cannot start a transport after close");
});
