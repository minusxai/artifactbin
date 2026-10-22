import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { installScript } from "../src/server/install-script.ts";
import { skillArchive } from "../src/server/skill-archive.ts";

function fixture(run: (root: string, install: (mode?: string) => ReturnType<typeof spawnSync>) => void) {
  const root = mkdtempSync(join(tmpdir(), "pagegi-installer-"));
  const home = join(root, "home with spaces"), bin = join(root, "bin");
  mkdirSync(home); mkdirSync(bin); mkdirSync(join(root, "tmp"));
  writeFileSync(join(root, "skill.tgz"), skillArchive().body);
  writeFileSync(join(root, "install.sh"), installScript("https://example.invalid"));
  writeFileSync(join(bin, "curl"), '#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\ncp "$FIXTURE/skill.tgz" "$2"\n', { mode: 0o755 });
  const tar = spawnSync("sh", ["-c", "command -v tar"], { encoding: "utf8" }).stdout.trim();
  const mv = spawnSync("sh", ["-c", "command -v mv"], { encoding: "utf8" }).stdout.trim();
  writeFileSync(join(bin, "tar"), `#!/bin/sh\nif [ "$MODE" = extract-failure ] && [ "$1" = -xzf ]; then exit 23; fi\nexec "${tar}" "$@"\n`, { mode: 0o755 });
  writeFileSync(join(bin, "mv"), `#!/bin/sh\ncase "$MODE:$1:$2" in replacement-failure:*/artifactbin-author:*/artifactbin-author|restore-failure:*/artifactbin-author:*/artifactbin-author|restore-failure:*/previous:*/artifactbin-author) exit 24;; esac\nexec "${mv}" "$@"\n`, { mode: 0o755 });
  try { run(home, (mode = "") => spawnSync("sh", [join(root, "install.sh")], { encoding: "utf8", env: { ...process.env, HOME: home, FIXTURE: root, TMPDIR: join(root, "tmp"), MODE: mode, PATH: `${bin}:${process.env.PATH}` } })); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
test("a Codex-only home discovers .codex and installs the standard shared skill", () => fixture((home, install) => {
  mkdirSync(join(home, ".codex"));
  const result = install(); assert.equal(result.status, 0, String(result.stderr));
  assert.ok(existsSync(join(home, ".agents/skills/artifactbin-author/SKILL.md")));
}));
for (const mode of ["extract-failure", "replacement-failure"]) {
  test(`${mode} preserves the previous skill and unrelated files`, () => fixture((home, install) => {
    const folder = join(home, ".claude/skills"); mkdirSync(join(folder, "artifactbin-author"), { recursive: true });
    writeFileSync(join(folder, "artifactbin-author/old"), "keep"); writeFileSync(join(folder, "unrelated"), "untouched");
    const result = install(mode); assert.notEqual(result.status, 0);
    assert.equal(readFileSync(join(folder, "artifactbin-author/old"), "utf8"), "keep");
    assert.equal(readFileSync(join(folder, "unrelated"), "utf8"), "untouched");
    // Rolled back: no staging folder is left beside it, and the download is gone.
    assert.deepEqual(readdirSync(folder).sort(), ["artifactbin-author", "unrelated"]);
    assert.deepEqual(readdirSync(join(dirname(home), "tmp")), []);
  }));
}
test("a failed restore keeps the backup in its staging folder and still removes the download", () => fixture((home, install) => {
  const folder = join(home, ".claude/skills"); mkdirSync(join(folder, "artifactbin-author"), { recursive: true });
  writeFileSync(join(folder, "artifactbin-author/old"), "keep");
  const result = install("restore-failure"); assert.notEqual(result.status, 0);
  const staged = readdirSync(folder).filter((name) => name.startsWith(".artifactbin-author."));
  assert.equal(staged.length, 1);
  assert.equal(readFileSync(join(folder, staged[0]!, "previous/old"), "utf8"), "keep");
  assert.deepEqual(readdirSync(join(dirname(home), "tmp")), []);
}));
test("an upgrade replaces stale owned files and preserves unrelated skills", () => fixture((home, install) => {
  const folder = join(home, ".claude/skills"); mkdirSync(join(folder, "artifactbin-author"), { recursive: true });
  writeFileSync(join(folder, "artifactbin-author/stale"), "old"); writeFileSync(join(folder, "unrelated"), "keep");
  const result = install(); assert.equal(result.status, 0, String(result.stderr));
  assert.ok(existsSync(join(folder, "artifactbin-author/SKILL.md")));
  assert.equal(existsSync(join(folder, "artifactbin-author/stale")), false);
  assert.equal(readFileSync(join(folder, "unrelated"), "utf8"), "keep");
}));

for (const defect of ["corrupt", "missing-manifest", "unrelated-root", "symlink"]) {
  test(`a ${defect} archive fails before replacing an installed skill`, () => fixture((home, install) => {
    const root = dirname(home), folder = join(home, ".claude/skills/artifactbin-author");
    mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, "old"), "keep");
    if (defect === "corrupt") writeFileSync(join(root, "skill.tgz"), "not a tar archive");
    else {
      const payload = join(root, "payload"); mkdirSync(payload);
      const name = defect === "unrelated-root" ? "unrelated" : "pagegi-author";
      mkdirSync(join(payload, name));
      if (defect === "symlink") symlinkSync("/tmp", join(payload, name, "SKILL.md"));
      else writeFileSync(join(payload, name, "README"), "invalid bundle");
      const archive = spawnSync("tar", ["-czf", join(root, "skill.tgz"), "-C", payload, name], { encoding: "utf8" });
      assert.equal(archive.status, 0, archive.stderr);
    }
    const result = install(); assert.notEqual(result.status, 0);
    assert.equal(readFileSync(join(folder, "old"), "utf8"), "keep");
    assert.equal(existsSync(join(home, ".claude/skills/unrelated")), false);
  }));
}

// Packed npm execution belongs to the local integration tier.
import "../installer/integration.test.mjs";

test("shell install uses its custom origin, backs up the legacy skill and repeats without duplicates", () => fixture((home, install) => {
  const parent = join(home, ".claude/skills");
  mkdirSync(join(parent, "pagegi-author"), { recursive: true });
  writeFileSync(join(parent, "pagegi-author/SKILL.md"), "legacy");
  writeFileSync(join(parent, "pagegi-author/my-notes"), "retain");
  for (let count = 0; count < 2; count++) {
    const result = install(); assert.equal(result.status, 0, String(result.stderr));
  }
  assert.deepEqual(readdirSync(parent), ["artifactbin-author"]);
  const backups = join(home, ".af/skill-backups");
  const [backup] = readdirSync(backups);
  assert.equal(readFileSync(join(backups, backup!, "pagegi-author/my-notes"), "utf8"), "retain");
  const installed = join(parent, "artifactbin-author");
  for (const file of ["SKILL.md", "scripts/lib/af-lib.mjs", "examples/todo.html"])
    assert.ok(readFileSync(join(installed, file), "utf8").includes("https://example.invalid"), file);
  assert.doesNotMatch(readFileSync(join(installed, "SKILL.md"), "utf8"), /https:\/\/app\.artefactbin\.dev/);
}));
