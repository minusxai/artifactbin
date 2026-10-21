import { test } from "node:test";
import assert from "node:assert/strict";
import { homeScreen } from "../src/navigation.js";
test("route intent never exposes a signed-out or library screen before authentication resolves", () => {
  for (const account of [false, true]) {
    assert.equal(homeScreen({ session: "pending", account }), "loading");
    assert.equal(homeScreen({ session: "failed", account }), "error");
    assert.equal(homeScreen({ session: "signed-out", account }), "welcome");
    assert.equal(
      homeScreen({ session: "signed-in", account }),
      account ? "account" : "library",
    );
  }
});

test("login returns to supported document links and rejects ambiguous or external paths", async () => {
  const { loginDestination } = await import("../src/navigation.js");
  for (const path of ["/af/v1/ids/Pg4mQ2", "/af/v1/ids/Pg4mQ2?view=latest", "/a/Pg4mQ2", "/a/Pg4mQ2-my-title", "/a/Pg4mQ2?download=1", "/@alice/notes.html", "/@alice%40example.test/research/notes.html?download=1", "/connect?code=0123456789ab"])
    assert.equal(loginDestination(path), path);
  for (const path of ["/connect", "/connect/x?code=0123456789ab", "/connect?code=../x", "/connected?code=0123456789ab"])
    assert.equal(loginDestination(path), null, path);
  for (const path of ["/d/document-id", "/documents/document-id", "/f/folder/page.html", "/af/v1/ids/Pg4mQ", "/af/v1/ids/Pg4mQ2/x", "/af/v1/ids/../account", "/af/v1/ids/%2e%2e/accnt", "//external.example/af/v1/ids/Pg4mQ2", "/af/v1/ids/Pg4mQ2#x", "/af/v1/core.js", "/a/Pg4mQ", "/a/Pg4mQ2/x", "/a/Pg4mQ2-slug/x", "//external.example/a/Pg4mQ2", "/a/Pg4mQ2#x", "/@alice", "/@alice/", "/@alice/../account", "/@alice/%2e%2e/account", "//external.example/@alice/notes.html", "/@alice/notes.html#x", "/\\@alice/notes.html"])
    assert.equal(loginDestination(path), null, path);
  for (const path of [null, "", "/", "/account", "https://external.example/d/id", "//external.example/d/id", "/\\external.example/d/id", "/d/../account", "/d/%2e%2e/account", "/d/%2F%2Fexternal.example", "/d/%5cexternal.example", "/d/%252fexternal.example", "/%64/id", "/d/id#fragment", "/d/id\n", "/d/", "/documents//id", "/f/%00name", "/d/%ZZ"])
    assert.equal(loginDestination(path), null, String(path));
});

test("login destinations accept exactly the page addresses the server resolves", async () => {
  const { loginDestination } = await import("../src/navigation.js");
  const { parseAddressPath } = await import("../src/ids/file-id.ts");
  for (const path of ["/a/Pg4mQ2", "/a/Pg4mQ2-title", "/a/Pg4mQ2-a/b", "/a/Pg4mQ", "/@alice/notes.html", "/@alice%40x.test/a%20b/c.html", "/@alice", "/@alice/", "/@alice//x", "/@alice/./x", "/@alice/%2e%2e/x", "/@alice/%2fx", "/@alice/%ZZ", "/@/x", "/account", "/af/v1/ids/Pg4mQ2", "/af/v1/ids/Pg4mQ2/x"])
    assert.equal(loginDestination(path) !== null, /^\/af\/v1\/ids\/[A-Za-z0-9]{6}$/.test(path) || parseAddressPath(path) !== null, path);
});

test("runner URLs accept HTTP(S) and reject executable protocols", async () => {
  const { runnerURL } = await import("../src/navigation.js");
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///tmp/app",
  ])
    assert.throws(
      () => runnerURL(value, "https://platform.example/d/abc"),
      /runner URL/,
    );
  assert.equal(
    runnerURL("https://abc.apps.example/runner", "https://platform.example")
      .href,
    "https://abc.apps.example/runner",
  );
  assert.equal(
    runnerURL("http://localhost:1234/runner", "http://localhost:4321").protocol,
    "http:",
  );
});
