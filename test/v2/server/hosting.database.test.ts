import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESIGN_SYSTEMS, SKILL_ARCHIVE_PATH } from "../../../src/af-contracts.ts";
import type { PublishResponse } from "../../../src/server/af-api-contracts.ts";
import { skillFile, skillFiles } from "../support/skill.ts";
import { page, startServer } from "../support/server.ts";

test("the server serves the core and every design system under /af/v1/", async () => {
  const server = await startServer();
  try {
    const core = await server.request("/af/v1/core.js");
    assert.equal(core.status, 200);
    assert.match(core.headers.get("content-type") ?? "", /javascript/);
    assert.ok((await core.text()).length > 0);
    assert.deepEqual(
      skillFiles("design-systems"),
      DESIGN_SYSTEMS.map((name) => `${name}.css`).sort(),
    );
    for (const name of DESIGN_SYSTEMS) {
      const css = await server.request(`/af/v1/design-systems/${name}.css`);
      assert.equal(css.status, 200, name);
      assert.match(css.headers.get("content-type") ?? "", /text\/css/);
      assert.equal(await css.text(), skillFile(`design-systems/${name}.css`), name);
    }
    for (const path of ["/af/v1/design-systems/unknown.css", "/af/v1/design-systems/core.js", "/af/v1/nothing"])
      assert.equal((await server.request(path)).status, 404, path);
  } finally {
    await server.close();
  }
});

test("the server serves the whole author skill as one archive an agent can extract into its skills folder", async () => {
  const server = await startServer();
  const folder = mkdtempSync(join(tmpdir(), "pagegi-skills-"));
  try {
    const response = await server.request(SKILL_ARCHIVE_PATH);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/gzip");
    assert.doesNotMatch(response.headers.get("cache-control") ?? "", /no-store/);
    const archive = join(folder, "pagegi-author.tgz");
    writeFileSync(archive, new Uint8Array(await response.arrayBuffer()));
    execFileSync("tar", ["-xzf", archive, "-C", folder]);
    for (const file of [
      "SKILL.md",
      "references/scripts.md",
      "references/http-api.md",
      "references/state.md",
      "references/backend.md",
      "scripts/auth.mjs",
      "scripts/publish.mjs",
      "scripts/lib/af-lib.mjs",
      "examples/todo.html",
      "examples/backends/todos.ts",
      `design-systems/${DESIGN_SYSTEMS[0]}.css`,
    ])
      assert.equal(readFileSync(join(folder, "pagegi-author", file), "utf8"), skillFile(file), file);
    assert.ok(statSync(join(folder, "pagegi-author/scripts/auth.mjs")).mode & 0o100, "scripts stay executable");
    // The same bytes again: the archive is built once and cached.
    const again = await server.request(SKILL_ARCHIVE_PATH);
    assert.ok(Buffer.from(await again.arrayBuffer()).equals(readFileSync(archive)));
    for (const path of ["/skills/other.tgz", "/skills/", "/skills/pagegi-author"])
      assert.equal((await server.request(path)).status, 404, path);
  } finally {
    rmSync(folder, { recursive: true, force: true });
    await server.close();
  }
});

test("a page's address opens the page, and ?download=1 gives a file that works on its own", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const published = (await (
      await server.request("/api/publish", {
        token,
        body: { source: page("<h1>Hosted</h1>"), requestId: "hosted", visibility: "public" },
      })
    ).json()) as PublishResponse;
    const view = await server.request(`/af/v1/ids/${published.id}`);
    assert.equal(view.status, 200);
    assert.match(view.headers.get("content-type") ?? "", /text\/html/);
    const download = await server.request(`/af/v1/ids/${published.id}?download=1`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
    const html = await download.text();
    // The file records its server and version on the core tag, so a browser that reaches the server can reconnect it.
    assert.match(
      html,
      new RegExp(`<script data-af="core" data-af-server="${server.origin}" data-af-revision="[0-9a-f]{64}">[\\s\\S]+?</script>`),
    );
    assert.match(html, /<link rel="stylesheet" data-af="design-system" href="data:text\/css;base64,[A-Za-z0-9+/=]+">/);
    assert.match(html, /<h1 data-af-id="[^"]+">Hosted<\/h1>/);
    assert.doesNotMatch(html, /src="[^"]*\/af\/v1\/core\.js"/);
    assert.equal((await server.request("/af/v1/ids/Zz9Zz9")).status, 404);
  } finally {
    await server.close();
  }
});

test("one command installs the skill for every coding agent on the machine, from this server", async () => {
  const server = await startServer();
  const home = mkdtempSync(join(tmpdir(), "af-install-home-"));
  try {
    const response = await server.request("/install.sh");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /x-shellscript/);
    const script = await response.text();
    assert.ok(script.includes(`${server.origin}/skills/pagegi-author.tgz`), "downloads the archive from this server");
    // A machine with Claude Code and Pi, without Codex or OpenCode.
    mkdirSync(join(home, ".pi"), { recursive: true });
    // The server answers from this process, so the install must run without blocking it.
    const { stdout: output } = await run("sh", ["-c", `curl -fsSL ${server.origin}/install.sh | sh`], { env: { ...process.env, HOME: home }, encoding: "utf8" });
    for (const folder of [".claude/skills", ".pi/agent/skills"]) {
      assert.equal(readFileSync(join(home, folder, "pagegi-author/SKILL.md"), "utf8"), skillFile("SKILL.md"), folder);
      assert.ok(statSync(join(home, folder, "pagegi-author/scripts/publish.mjs")).mode & 0o100, `${folder}: scripts stay executable`);
      assert.ok(output.includes(`Installed Artifactbin author skill in ${join(home, folder)}`));
    }
    assert.ok(!existsSync(join(home, ".agents")) && !existsSync(join(home, ".config/opencode")), "no folders for absent harnesses");
    assert.match(output, /Done: the skill is in 2 folder\(s\)/);
    // Running it again replaces the copy instead of failing or nesting.
    writeFileSync(join(home, ".claude/skills/pagegi-author/stale.txt"), "old");
    await run("sh", ["-c", `curl -fsSL ${server.origin}/install.sh | sh`], { env: { ...process.env, HOME: home }, encoding: "utf8" });
    assert.ok(!existsSync(join(home, ".claude/skills/pagegi-author/stale.txt")), "an older copy is replaced");
  } finally {
    rmSync(home, { recursive: true, force: true });
    await server.close();
  }
});

test("the welcome page's local example is a file that works on its own, like a download", async () => {
  const server = await startServer();
  try {
    const download = await server.request("/example.html");
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") ?? "", /attachment; filename="pagegi-example\.html"/);
    const html = await download.text();
    assert.match(html, /<script data-af="core">[\s\S]+?<\/script>/, "the core is inlined");
    assert.match(html, /<link rel="stylesheet" data-af="design-system" href="data:text\/css;base64,/, "the design system is embedded");
    assert.doesNotMatch(html, /src="[^"]*\/af\/v1\/core\.js"/, "nothing is fetched from a server");
    assert.match(html, /<form id="new"/, "it is the todo example");
    // Link checkers and download managers probe with HEAD: it answers like GET, without a body.
    const head = await server.request("/example.html", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.match(head.headers.get("content-disposition") ?? "", /pagegi-example\.html/);
    assert.equal(await head.text(), "");
    const home = await server.request("/", { method: "HEAD" });
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(await home.text(), "");
  } finally {
    await server.close();
  }
});

test("a newly published page is unlisted: a signed-out visitor with the link can open it", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const published = (await (
      await server.request("/api/publish", {
        token,
        body: { source: page("<h1>Open by link</h1>"), requestId: "default-visibility" },
      })
    ).json()) as PublishResponse;
    const sharing = (await (await server.request(`/api/files/${published.id}/sharing`, { token })).json()) as {
      policy: { visibility: string; linkRole: string };
    };
    assert.equal(sharing.policy.visibility, "unlisted");
    assert.equal(sharing.policy.linkRole, "viewer");

    // No token and no cookie: the hosted view and the state it loads.
    const view = await server.request(`/af/v1/ids/${published.id}`, { headers: { Accept: "text/html" } });
    assert.equal(view.status, 200, "no redirect to sign in");
    assert.match(view.headers.get("content-type") ?? "", /text\/html/);
    const hosted = await server.request(`/api/library/${published.id}/host`);
    assert.equal(hosted.status, 200);
    const state = (await hosted.json()) as {
      source: string;
      boot: { token: string | null; permissions: { read: boolean; comment: boolean; edit: boolean } };
    };
    assert.match(state.source, /Open by link/);
    assert.equal(state.boot.token, null, "a signed-out viewer gets no session");
    assert.deepEqual(
      [state.boot.permissions.read, state.boot.permissions.comment, state.boot.permissions.edit],
      [true, false, false],
    );
    // Unlisted is not public: it is not listed for discovery.
    const listed = (await (await server.request("/api/public")).json()) as { files: { id?: string; fileId?: string }[] };
    assert.ok(!JSON.stringify(listed).includes(published.id));
  } finally {
    await server.close();
  }
});

test("a private page's address does not reveal it to strangers", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const published = (await (
      await server.request("/api/publish", {
        token,
        body: { source: page("<h1>Secret</h1>"), requestId: "private", visibility: "private" },
      })
    ).json()) as PublishResponse;
    const stranger = await server.request(`/af/v1/ids/${published.id}?download=1`);
    assert.notEqual(stranger.status, 200);
    assert.doesNotMatch(await stranger.text(), /Secret/);
  } finally {
    await server.close();
  }
});

test("the hosted representation carries the page's own design system's CSS inline and the source exactly as saved", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const dossier = (await (
      await server.request("/api/publish", {
        token,
        body: { source: page("<h1>Dossier</h1>").replace("<html>", '<html data-af-design-system="dossier">'), requestId: "hosted-dossier" },
      })
    ).json()) as PublishResponse;
    const plain = (await (
      await server.request("/api/publish", { token, body: { source: page("<h1>Default</h1>"), requestId: "hosted-default" } })
    ).json()) as PublishResponse;
    for (const [published, name] of [
      [dossier, "dossier"],
      [plain, "meridian"],
    ] as const) {
      const hosted = (await (await server.request(`/api/library/${published.id}/host`)).json()) as {
        source: string;
        designSystem: { name: string; href: string };
      };
      assert.equal(hosted.source, published.source, "the runtime keys the version by the saved source's digest");
      assert.equal(hosted.designSystem.name, name);
      assert.equal(
        hosted.designSystem.href,
        "data:text/css;base64," + Buffer.from(skillFile(`design-systems/${name}.css`)).toString("base64"),
      );
    }
  } finally {
    await server.close();
  }
});
