import test from "node:test";
import assert from "node:assert/strict";
import { pairingExchange } from "../src/browser/pairing-exchange.ts";
test("pair exchange abort after response cannot publish credentials or approval URL", async () => {
  const abort = new AbortController();
  const urls: string[] = [];
  let finish!: (r: Response) => void;
  const result = pairingExchange({
    origin: "https://service.test",
    binding: {
      sourceRevision: "r",
      sessionId: "s",
      source: "<h1>x</h1>",
      requestId: "request",
    },
    signal: abort.signal,
    approve: (url) => urls.push(url),
    fetch: async () => new Promise((r) => (finish = r)),
  });
  abort.abort();
  finish(new Response(JSON.stringify({ code: "c", deviceCode: "secret" })));
  await assert.rejects(result, /abort|cancel/i);
  assert.equal(urls.length, 0);
});
test("pair exchange validates publication, returns only typed result and checks cancellation after poll", async () => {
  const abort = new AbortController();
  let calls = 0;
  const urls: string[] = [];
  const result = pairingExchange({
    origin: "https://service.test",
    binding: {
      fileId: "f",
      share: "read",
      sourceRevision: "r",
      sessionId: "s",
    },
    signal: abort.signal,
    approve: (url) => urls.push(url),
    sleep: async () => {},
    fetch: async () => {
      calls++;
      if (calls === 1)
        return new Response(
          JSON.stringify({ code: "c", deviceCode: "secret" }),
        );
      abort.abort();
      return new Response(JSON.stringify({ token: "late", username: "user" }));
    },
  });
  await assert.rejects(result, /abort|cancel/i);
  assert.deepEqual(urls, ["https://service.test/connect?code=c"]);
});
test("trusted exchange explicitly requests document capability and rejects a downgraded response", async () => {
  const calls: any[] = [];
  const options = {
    origin: "https://service.test",
    binding: {
      fileId: "f",
      share: "read",
      sourceRevision: "r",
      sessionId: "s",
    },
    signal: new AbortController().signal,
    approve: () => {},
    sleep: async () => {},
    fetch: async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify(
          calls.length === 1
            ? { code: "c", deviceCode: "secret" }
            : { token: "credential", username: "alice" },
        ),
      );
    },
  };
  await assert.rejects(pairingExchange(options), /purpose|capability/i);
  assert.equal(calls[0].purpose, "document");
});
