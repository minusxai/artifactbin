import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConnection,
  saveConnection,
  parseArgs,
  normalizeServer,
} from "../src/config";
test("reuses plugin credentials, scopes to host, saves privately without shell evaluation", async () => {
  const home = await mkdtemp(join(tmpdir(), "afbin-test-"));
  try {
    assert.equal(await loadConnection(undefined, home, {}), null);
    await saveConnection(
      { server: "https://artifactbin.dev", token: "mx_test" },
      home,
    );
    assert.deepEqual(await loadConnection(undefined, home, {}), {
      server: "https://artifactbin.dev",
      token: "mx_test",
    });
    assert.equal(await loadConnection("http://localhost:6400", home, {}), null);
    assert.equal(
      await loadConnection(undefined, home, {
        ARTIFACTBIN_URL: "http://localhost:6400",
      }),
      null,
    );
    assert.equal(
      (await stat(join(home, ".artifactbin.env"))).mode & 0o777,
      0o600,
    );
    assert.match(
      await readFile(join(home, ".artifactbin.env"), "utf8"),
      /ARTIFACTBIN_TOKEN=mx_test/,
    );
    assert.equal(
      await loadConnection("http://localhost:6400", home, {
        ARTIFACTBIN_TOKEN: "prod",
        ARTIFACTBIN_URL: "https://artifactbin.dev",
      }),
      null,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("passes harness flags untouched and rejects unsafe server URLs", () => {
  assert.deepEqual(
    parseArgs([
      "remote",
      "--server",
      "http://localhost:6400",
      "--name",
      "Demo",
      "claude",
      "--chrome",
      "--resume",
    ]),
    {
      command: "remote",
      server: "http://localhost:6400",
      name: "Demo",
      harness: "claude",
      args: ["--chrome", "--resume"],
    },
  );
  assert.throws(() => normalizeServer("https://user:secret@example.com"));
  assert.throws(() => normalizeServer("http://example.com"));
  assert.throws(() => normalizeServer("https://example.com/path"));
  assert.equal(
    normalizeServer("http://127.0.0.1:6400/"),
    "http://127.0.0.1:6400",
  );
});
