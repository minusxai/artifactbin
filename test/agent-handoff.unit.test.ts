import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { DEFAULT_AF_ORIGIN } from "../src/af-contracts.ts";
import { agentHandoff } from "../src/library-client/agent-handoff.ts";
import { repositoryPath } from "./v2/support/load.ts";

const origin = "https://pagegi.example";

test("the handoff names the server, the one-line install and how to sign in, and nothing else", () => {
  const text = agentHandoff(origin);
  assert.match(text, /^Build me a Pagegi page and publish it to https:\/\/pagegi\.example\./);
  assert.ok(text.includes(`curl -fsSL ${origin}/install.sh | sh`), "one-line install from this server");
  assert.ok(text.includes("pagegi-author/SKILL.md"), "names the skill file to follow");
  assert.match(text, /scripts\/auth\.mjs --email <my email address>/);
  assert.match(text, /If I haven't said what to build, ask me\./);
  assert.doesNotMatch(text, /AF_TOKEN|Bearer|token/i, "tokenless");
  assert.doesNotMatch(text, /tar |mkdir|\.tgz|~\/\./, "no manual install steps");
  assert.ok(text.split("\n").filter(Boolean).length <= 4, "short enough to read at a glance");
});

test("AF_SERVER is named only for a server other than the skill's default", () => {
  assert.ok(agentHandoff(origin).includes(`AF_SERVER=${origin}`));
  assert.doesNotMatch(agentHandoff(DEFAULT_AF_ORIGIN), /AF_SERVER/);
});

test("every skill file the handoff names exists", () => {
  for (const file of agentHandoff(origin).matchAll(/pagegi-author\/([\w./-]+\.(?:md|mjs))/g))
    assert.ok(existsSync(repositoryPath(`skills/pagegi-author/${file[1]}`)), file[1]);
});

test("the signed-in address fills the sign-in step, and a trailing slash on the origin is dropped", () => {
  const text = agentHandoff(origin + "/", "ann@example.test");
  assert.match(text, /scripts\/auth\.mjs --email ann@example\.test/);
  assert.doesNotMatch(text, /<my email address>/);
  assert.doesNotMatch(text, /example\/\//);
});
