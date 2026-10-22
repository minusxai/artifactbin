import { test } from "node:test";
import assert from "node:assert/strict";
import { createDocumentDownload } from "../src/browser/document-download.ts";
import type { DocumentDownloadOptions } from "../src/browser/document-download-contracts.ts";
import { withState } from "../src/browser/core/standalone.ts";

function fixture(overrides: Partial<DocumentDownloadOptions> = {}) {
  const messages: string[] = [],
    releases: string[] = [];
  const starts: { url: string; name: string }[] = [];
  const files: Blob[] = [],
    requests: string[] = [];
  const timers: { callback(): void; delay: number }[] = [];
  let delegated = 0;
  const html = "<html><head></head><body>Saved page</body></html>";
  const options: DocumentDownloadOptions = {
    local: false,
    delegate: () => {
      delegated++;
    },
    hostedPath: () => "/folder/report.html",
    address: () => "https://example.test/page?version=3#private-state",
    title: () => "Title",
    snapshot: () => ({ historical: false, state: { draft: "current" } }),
    fetch: async (address, options) => {
      requests.push(address);
      assert.equal(options.credentials, "same-origin");
      return { ok: true, text: async () => html };
    },
    sink: {
      create: (file) => {
        files.push(file);
        return "blob:download";
      },
      start: (url, name) => {
        starts.push({ url, name });
      },
      release: (url) => {
        releases.push(url);
      },
      later: (callback, delay) => {
        timers.push({ callback, delay });
      },
    },
    status: (message) => {
      messages.push(message);
    },
    ...overrides,
  };
  return {
    options,
    html,
    messages,
    releases,
    starts,
    files,
    requests,
    timers,
    delegated: () => delegated,
    controller: createDocumentDownload(options),
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("local download delegates without reading hosted state or fetching", async () => {
  const f = fixture({
    local: true,
    snapshot: () => {
      throw Error("must not read");
    },
  });
  assert.equal(f.controller.download(), "download-started");
  await settle();
  assert.equal(f.delegated(), 1);
  assert.equal(f.requests.length, 0);
  assert.equal(f.messages.length, 1);
});

test("hosted download captures current view state and releases its object URL after activation", async () => {
  const f = fixture();
  f.controller.download();
  await settle();
  assert.deepEqual(f.requests, ["https://example.test/page?download=1"]);
  assert.equal(
    await f.files[0]!.text(),
    withState(f.html, { draft: "current" }),
  );
  assert.equal(f.files[0]!.type, "text/html");
  assert.deepEqual(f.starts, [{ url: "blob:download", name: "report.html" }]);
  assert.deepEqual(f.releases, []);
  assert.equal(f.timers[0]!.delay, 60_000);
  f.timers[0]!.callback();
  assert.deepEqual(f.releases, ["blob:download"]);
});

test("historical download keeps server state and title fallback is sanitized", async () => {
  const f = fixture({
    hostedPath: () => null,
    title: () => "  A: report!  ",
    snapshot: () => ({ historical: true, state: { draft: "must not export" } }),
  });
  f.controller.download();
  await settle();
  assert.equal(await f.files[0]!.text(), f.html);
  assert.equal(f.starts[0]!.name, "A report.html");
});

test("fetch and body failures report failure without creating a download", async () => {
  for (const fetch of [
    async () => ({ ok: false, text: async () => "" }),
    async () => ({
      ok: true,
      text: async () => {
        throw Error("Body failed");
      },
    }),
  ]) {
    const f = fixture({ fetch });
    f.controller.download();
    await settle();
    assert.equal(f.files.length, 0);
    assert.equal(f.messages.length, 2);
    assert.match(f.messages[1]!, /failed/i);
  }
});

test("activation and timer failures immediately release the created object URL", async () => {
  for (const failure of ["start", "later"] as const) {
    const f = fixture();
    f.options.sink[failure] = () => {
      throw Error("Sink failed");
    };
    f.controller.download();
    await settle();
    assert.deepEqual(f.releases, ["blob:download"]);
    assert.equal(f.messages.at(-1), "Sink failed");
  }
});
