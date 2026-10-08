import {autoUpdatePolicy,claudeConfigEnvironment} from '../src/config';
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hostDirectory,
  loadConnection,
  saveConnection,
  normalizeServer,
} from "../src/config";
test("reads the single credential directory, scopes to host, saves privately without shell evaluation", async () => {
  const home = await mkdtemp(join(tmpdir(), "afbin-test-"));
  try {
    assert.equal(await loadConnection(undefined, home, {}), null);
    await saveConnection(
      { server: "https://app.artifactbin.dev", token: "mx_test" },
      home,
    );
    assert.deepEqual(await loadConnection(undefined, home, {}), {
      server: "https://app.artifactbin.dev",
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
      (await stat(join(hostDirectory("https://app.artifactbin.dev", home, {}), "credentials.env"))).mode & 0o777,
      0o600,
    );
    assert.match(
      await readFile(join(hostDirectory("https://app.artifactbin.dev", home, {}), "credentials.env"), "utf8"),
      /ARTIFACTBIN_TOKEN=mx_test/,
    );
    assert.equal(
      await loadConnection("http://localhost:6400", home, {
        ARTIFACTBIN_TOKEN: "prod",
        ARTIFACTBIN_URL: "https://app.artifactbin.dev",
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
test("accepts plain http only on a local development host", () => {
  // The dev app serves at http://app.<pages host>:<port>, and *.lvh.me resolves to 127.0.0.1.
  assert.equal(normalizeServer("http://app.lvh.me:3030"), "http://app.lvh.me:3030");
  for (const origin of ["http://localhost:3030", "http://127.0.0.1:3030", "http://[::1]:3030", "http://lvh.me:3030",
    "http://app.localhost:3030", "http://artifactbin.test:3030", "http://APP.LVH.ME:3030"])
    assert.equal(normalizeServer(origin), new URL(origin).origin, origin);
  // Everything else keeps requiring https, including names that only look local.
  for (const origin of ["http://example.com", "http://lvh.me.example.com", "http://evil-lvh.me", "http://app.lvh.me.evil.com",
    "http://localhost.example.com", "http://test", "http://notlocalhost", "http://10.0.0.1:3030", "http://example.testing"])
    assert.throws(() => normalizeServer(origin), /HTTPS server origin/, origin);
  assert.equal(normalizeServer("https://example.com"), "https://example.com");
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
    assert.deepEqual(await loadConnection(connection.server, home, {}), connection);
    assert.deepEqual(await loadConnection(undefined, home, {ARTIFACTBIN_URL:connection.server, ARTIFACTBIN_TOKEN:'mx_explicit'}), {server:connection.server, token:'mx_explicit'});
  } finally { await rm(home,{recursive:true,force:true}); }
});

test("keeps one credential per origin, so switching servers never re-prompts or overwrites", async () => {
  const home = await mkdtemp(join(tmpdir(), "afbin-origins-"));
  try {
    await saveConnection({ server: "https://app.artifactbin.dev", token: "mx_prod" }, home, {});
    await saveConnection({ server: "http://localhost:3030", token: "mx_local" }, home, {});
    assert.deepEqual(await loadConnection(undefined, home, {}), { server: "https://app.artifactbin.dev", token: "mx_prod" });
    assert.deepEqual(await loadConnection("http://localhost:3030", home, {}), { server: "http://localhost:3030", token: "mx_local" });
    assert.deepEqual(await loadConnection(undefined, home, { ARTIFACTBIN_URL: "http://localhost:3030" }), { server: "http://localhost:3030", token: "mx_local" });
    assert.match(await readFile(join(hostDirectory("https://app.artifactbin.dev", home, {}), "credentials.env"), "utf8"), /ARTIFACTBIN_TOKEN=mx_prod/);
    await saveConnection({ server: "http://localhost:3030", token: "mx_local2" }, home, {});
    assert.deepEqual(await loadConnection("http://localhost:3030", home, {}), { server: "http://localhost:3030", token: "mx_local2" });
    assert.deepEqual(await loadConnection(undefined, home, {}), { server: "https://app.artifactbin.dev", token: "mx_prod" });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("ARTIFACTBIN_HOME selects a separate private state directory", async () => {
  const home = await mkdtemp(join(tmpdir(), "afbin-home-"));
  try {
    const env = { ARTIFACTBIN_HOME: join(home, ".artifactbin.local") };
    await saveConnection({ server: "http://localhost:3030", token: "mx_local" }, home, env);
    assert.deepEqual(await loadConnection("http://localhost:3030", home, env), { server: "http://localhost:3030", token: "mx_local" });
    assert.equal(await loadConnection("http://localhost:3030", home, {}), null);
    assert.equal((await stat(join(home, ".artifactbin.local"))).mode & 0o777, 0o700);
    await assert.rejects(stat(join(home, ".artifactbin")), { code: "ENOENT" });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('automatic update policy is opt-out and a version pin always suppresses background changes',()=>{
 assert.deepEqual(autoUpdatePolicy({}),{enabled:true});
 for(const value of ['0','false','off'])assert.equal(autoUpdatePolicy({CLI__AUTO_UPDATE:value}).enabled,false);
 assert.deepEqual(autoUpdatePolicy({CLI__VERSION_PIN:'1.2.3'}),{enabled:false,pin:'1.2.3'});
 assert.equal(autoUpdatePolicy({CLI__VERSION_PIN:'bad'}).enabled,false);
});

test('legacy apex credentials stay scoped to an explicit legacy server', async () => {
 const home = await mkdtemp(join(tmpdir(), 'afbin-legacy-origin-'));
 try {
  await saveConnection({server:'https://artifactbin.dev',token:'mx_legacy'},home,{});
  assert.equal(await loadConnection(undefined,home,{}),null);
  assert.deepEqual(await loadConnection('https://artifactbin.dev',home,{}),{server:'https://artifactbin.dev',token:'mx_legacy'});
 } finally { await rm(home,{recursive:true,force:true}); }
});

import {restoreRemoteContext,remoteContext} from '../src/config';
test('managed restoration touches only the scoped Artifactbin context and existing typed connection',async()=>{
 const env:NodeJS.ProcessEnv={PATH:'/safe/path',CODEX_HOME:'/existing/codex',PROVIDER_KEY:'mxmx_test_provider',OPENCODE_PERMISSION:'existing',ARTIFACTBIN_HOME:'/old'};
 const context={id:'mxmx_test_scoped',proof:'mxmx_test_proof',home:'/fresh/private',server:'http://localhost:6005',connection:{server:'http://localhost:6005',token:'mxmx_test.jwt.shaped',refreshToken:'mxmx_test_refresh',clientId:'mxmx_test_client'}};
 restoreRemoteContext(context,env);assert.deepEqual(remoteContext(env),{id:context.id,proof:context.proof});
 assert.deepEqual(await loadConnection(undefined,'/unused',env),context.connection);
 assert.equal(env.ARTIFACTBIN_HOME,context.home);assert.equal(env.PATH,'/safe/path');assert.equal(env.CODEX_HOME,'/existing/codex');assert.equal(env.PROVIDER_KEY,'mxmx_test_provider');assert.equal(env.OPENCODE_PERMISSION,'existing');
});


test('Claude launch preserves default auth namespace and explicit config scopes', () => {
 const caller = {HOME:'/synthetic/home', PATH:'/synthetic/bin'};
 const implicit = claudeConfigEnvironment('/synthetic/home/.claude', false, caller);
 assert.equal(Object.hasOwn(implicit, 'CLAUDE_CONFIG_DIR'), false);
 assert.deepEqual(implicit, caller);
 const changedCaller = {...caller, CLAUDE_CONFIG_DIR:'/synthetic/other'};
 const restoredDefault = claudeConfigEnvironment('/synthetic/home/.claude', false, changedCaller);
 assert.equal(Object.hasOwn(restoredDefault, 'CLAUDE_CONFIG_DIR'), false);
 assert.equal(changedCaller.CLAUDE_CONFIG_DIR, '/synthetic/other');
 const explicit = claudeConfigEnvironment('/synthetic/custom', true, caller);
 assert.equal(explicit.CLAUDE_CONFIG_DIR, '/synthetic/custom');
 assert.equal(Object.hasOwn(caller, 'CLAUDE_CONFIG_DIR'), false);
});
