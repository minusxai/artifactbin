import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AfScriptModule } from "../../../src/af-script/af-contracts.ts";
import { encodeState, stateAddress } from "../../../src/af-script/state-url.ts";
import { load } from "../support/load.ts";

test("state is UTF-8 JSON in base64url without padding, in an #af-state= fragment", () => {
  const state = { note: "é ✓?>", todos: [{ id: "1", done: false }] };
  const encoded = encodeState(state);
  assert.doesNotMatch(encoded, /[+/=]/);
  assert.equal(Buffer.from(encoded, "base64url").toString("utf8"), JSON.stringify(state));
  assert.equal(encodeState({ todos: [] }), "eyJ0b2RvcyI6W119");
  assert.equal(
    stateAddress("https://artifactbin.dev/af/v1/ids/Pg4mQ2", { todos: [] }),
    "https://artifactbin.dev/af/v1/ids/Pg4mQ2#af-state=eyJ0b2RvcyI6W119",
  );
  assert.equal(stateAddress("https://x.test/p?a=1#old", { todos: [] }), "https://x.test/p?a=1#af-state=eyJ0b2RvcyI6W119", "replaces a fragment");
});

test("shot --state takes a JSON file; a missing or invalid one exits 2 before Chrome starts", async () => {
  const { parseArguments, run } = await load<AfScriptModule>("src/af-script/af.ts");
  const command = parseArguments("shot", ["p.html", "--state", "view.json"]);
  assert.equal(command.kind === "shot" && command.state, "view.json");
  assert.throws(() => parseArguments("check", ["p.html", "--state", "view.json"]), /Usage/);
  const dir = mkdtempSync(join(tmpdir(), "af-state-"));
  try {
    writeFileSync(join(dir, "page.html"), "<!DOCTYPE html><title>x</title>");
    writeFileSync(join(dir, "bad.json"), "{ todos: ");
    for (const [file, message] of [
      ["missing.json", /Cannot read missing\.json/],
      ["bad.json", /bad\.json is not valid JSON/],
    ] as const) {
      let stderr = "";
      const io = { env: { CHROME_PATH: "/nonexistent/chrome" }, cwd: dir, stdout: () => {}, stderr: (text: string) => (stderr += text) };
      assert.equal(await run("shot", ["page.html", "--state", file], io), 2);
      assert.match(stderr, message);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
