import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createFontCaptureTransport } from "../src/migration/conversion/compiled/fonts/capture-transport.ts";
function transport(input: {
  addresses?: { address: string; family: number }[];
  status?: number;
  encoding?: string;
  chunks?: string[];
}) {
  let calls = 0,
    pinned = "";
  const run = createFontCaptureTransport({
    lookup: async () =>
      input.addresses ?? [{ address: "142.250.1.1", family: 4 }],
    request: ((_url: any, options: any, callback: any) => {
      calls++;
      assert.equal(options.agent, false);
      assert.equal(options.servername, "fonts.googleapis.com");
      assert.equal(options.headers["Accept-Encoding"], "identity");
      options.lookup(
        "ignored",
        {},
        (_e: any, address: string) => (pinned = address),
      );
      const req = new EventEmitter() as any;
      req.end = () => {
        const res = new PassThrough() as any;
        res.statusCode = input.status ?? 200;
        res.headers = {
          "content-type": "text/css",
          ...(input.encoding ? { "content-encoding": input.encoding } : {}),
        };
        callback(res);
        for (const chunk of input.chunks ?? ["abc"])
          if (!res.destroyed) res.write(chunk);
        res.end();
      };
      return req;
    }) as any,
  });
  return { run, calls: () => calls, pinned: () => pinned };
}
const url = "https://fonts.googleapis.com/css2?family=Example:wght@400";
test("capture transport pins validated DNS without redirects, encodings or oversized streams", async () => {
  const t = transport({});
  assert.equal(
    Buffer.from(
      await t.run(url, "stylesheet", {
        signal: new AbortController().signal,
        maxBytes: 5,
      }),
    ).toString(),
    "abc",
  );
  assert.equal(t.pinned(), "142.250.1.1");
  for (const config of [
    { status: 302 },
    { encoding: "gzip" },
    { chunks: ["abc", "def"] },
  ])
    await assert.rejects(() =>
      transport(config).run(url, "stylesheet", {
        signal: new AbortController().signal,
        maxBytes: 5,
      }),
    );
  const mixed = transport({
    addresses: [
      { address: "142.250.1.1", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
  });
  await assert.rejects(() =>
    mixed.run(url, "stylesheet", {
      signal: new AbortController().signal,
      maxBytes: 5,
    }),
  );
  assert.equal(mixed.calls(), 0);
});
test("capture aborts pending DNS without initiating a connection", async () => {
  let calls = 0;
  const controller = new AbortController();
  const run = createFontCaptureTransport({
    lookup: () => new Promise(() => {}),
    request: (() => {
      calls++;
      throw Error("unexpected");
    }) as any,
  });
  const result = run(url, "stylesheet", {
    signal: controller.signal,
    maxBytes: 5,
  });
  controller.abort();
  await assert.rejects(() => result);
  assert.equal(calls, 0);
});
test("synchronously aborting DNS never wins a connection race", async () => {
  const controller = new AbortController();
  let calls = 0;
  const run = createFontCaptureTransport({
    lookup: async () => {
      controller.abort();
      return [{ address: "142.250.1.1", family: 4 }];
    },
    request: (() => {
      calls++;
      throw Error("unexpected");
    }) as any,
  });
  await assert.rejects(() =>
    run(url, "stylesheet", { signal: controller.signal, maxBytes: 5 }),
  );
  assert.equal(calls, 0);
});
test("capture refuses a body closed before its end event", async () => {
  const run = createFontCaptureTransport({
    lookup: async () => [{ address: "142.250.1.1", family: 4 }],
    request: ((_u: any, _o: any, callback: any) => {
      const req = new EventEmitter() as any;
      req.end = () => {
        const res = new PassThrough() as any;
        res.statusCode = 200;
        res.headers = { "content-type": "text/css" };
        callback(res);
        res.write("a");
        res.destroy();
      };
      return req;
    }) as any,
  });
  await assert.rejects(() =>
    run(url, "stylesheet", {
      signal: new AbortController().signal,
      maxBytes: 5,
    }),
  );
});
