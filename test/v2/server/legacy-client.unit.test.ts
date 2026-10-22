/**
 * The earlier product's clients (src/server/legacy-client.ts): every path the
 * afbin CLI or its skill used answers 410 with the way forward, in the JSON
 * shape the CLI prints verbatim or as plain text; every other path is left alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { legacyClientAnswer } from "../../../src/server/legacy-client.ts";
import { INSTALLER_ARCHIVE_PATH } from "../../../src/server/installer-archive-contracts.ts";

const origin = "https://pages.example.test";

test("CLI API and sign-in paths answer 410 JSON with error, message and hint naming the installer", () => {
  for (const path of ["/api/artifacts", "/api/artifacts/Ab12Cd", "/api/artifacts/preflight", "/oauth/device", "/oauth/token"]) {
    const answer = legacyClientAnswer(path, origin);
    assert.ok(answer, path);
    assert.equal(answer.status, 410, path);
    assert.equal(answer.headers["Content-Type"], "application/json", path);
    const body = JSON.parse(answer.body) as { error: string; message: string; hint: string };
    assert.equal(body.error, "server_migrated", path);
    assert.match(body.message, /HTML pages/, path);
    assert.ok(body.hint.includes(`npx ${origin}${INSTALLER_ARCHIVE_PATH}`), path);
    assert.ok(body.hint.includes(`${origin}/a/<id>`), "existing addresses are promised");
  }
});

test("the old skill's HTTP entry points answer 410 as plain text with the same instruction", () => {
  for (const path of ["/llms.txt", "/llms/http-auth", "/chat/install.sh", "/chat/install-node.sh"]) {
    const answer = legacyClientAnswer(path, origin);
    assert.ok(answer, path);
    assert.equal(answer.status, 410, path);
    assert.match(answer.headers["Content-Type"] ?? "", /^text\/plain/, path);
    assert.ok(answer.body.includes(`npx ${origin}${INSTALLER_ARCHIVE_PATH}`), path);
    assert.doesNotMatch(answer.body, /[{}]/, "not JSON");
  }
});

test("nothing else is a legacy path: the new API, pages, assets, lookalikes", () => {
  for (const path of ["/api/publish", "/api/files/Ab12Cd/source", "/api/artifactsx", "/a/Ab12Cd", "/@alice/notes.html", "/", "/oauth", "/llms.txt/extra", "/llmstxt", "/chat/install.shx", "/skills/pagegi-author.tgz"])
    assert.equal(legacyClientAnswer(path, origin), null, path);
});
