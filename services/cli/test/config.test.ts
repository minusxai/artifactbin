import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConnection,
  saveConnection,
  normalizeServer,
} from "../src/config";
test("reads the single credential directory, scopes to host, saves privately without shell evaluation", async () => {
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
      (await stat(join(home, ".artifactbin/.env"))).mode & 0o777,
      0o600,
    );
    assert.match(
      await readFile(join(home, ".artifactbin/.env"), "utf8"),
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
test("rejects unsafe server URLs", () => {
  assert.throws(() => normalizeServer("https://user:secret@example.com"));
  assert.throws(() => normalizeServer("http://example.com"));
  assert.throws(() => normalizeServer("https://example.com/path"));
  assert.equal(
    normalizeServer("http://127.0.0.1:6400/"),
    "http://127.0.0.1:6400",
  );
});

test("does not load retired config or create state on a read", async () => {
 const home = await mkdtemp(join(tmpdir(), "afbin-config-"));
 try {
  await writeFile(join(home, ".artifactbin.env"), "ARTIFACTBIN_TOKEN=retired\n");
  assert.equal(await loadConnection(undefined, home, {}), null);
  await assert.rejects(stat(join(home, ".artifactbin")), {code:"ENOENT"});
  await saveConnection({server:"https://example.com",token:"saved"}, home);
  assert.equal((await stat(join(home,".artifactbin"))).mode & 0o777, 0o700);
  assert.deepEqual(await loadConnection(undefined, home, {ARTIFACTBIN_URL:"https://example.org", ARTIFACTBIN_TOKEN:"explicit"}), {server:"https://example.org",token:"explicit"});
 } finally { await rm(home,{recursive:true,force:true}); }
});

test("persists refresh credentials privately but explicit tokens never inherit them", async () => {
  const home = await mkdtemp(join(tmpdir(), 'afbin-refresh-'));
  try {
    const connection = {server:'https://example.com', token:'mx_access', refreshToken:'mxr_refresh', clientId:'afbin_cli', expiresAt:1900000000000};
    await saveConnection(connection, home);
    assert.deepEqual(await loadConnection(undefined, home, {}), connection);
    assert.deepEqual(await loadConnection(undefined, home, {ARTIFACTBIN_URL:connection.server, ARTIFACTBIN_TOKEN:'mx_explicit'}), {server:connection.server, token:'mx_explicit'});
  } finally { await rm(home,{recursive:true,force:true}); }
});
