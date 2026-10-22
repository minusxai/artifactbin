/** The skill is one consistent contract across its files (brief D owns the skill). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_AF_ORIGIN, DESIGN_SYSTEMS, FILE_ID_PATTERN, KNOWN_AF_ORIGINS, LEGACY_AF_ORIGINS } from "../../../src/af-contracts.ts";
import type { PathChange } from "../../../src/contracts.ts";
import type { PageModelModule } from "../../../src/page/page-contracts.ts";
import { load, repositoryPath } from "../support/load.ts";
import { SKILL_ROOT, skillFile, skillFiles } from "../support/skill.ts";
import { compileOnlyHost } from "../support/todo.ts";

/** Each example page with the backend file it links and the backend's name on the page. */
const examples = [
  { page: "examples/todo.html", backend: "examples/backends/todos.ts", name: "team" },
  { page: "examples/notes.html", backend: "examples/backends/notes.ts", name: "notes" },
];
const docs = ["SKILL.md", ...skillFiles("references").map((f) => `references/${f}`), ...examples.map((e) => e.page)];
const allText = () => docs.map((file) => [file, skillFile(file)] as const);

test("data-af-id is only ever a node ID; markers use data-af", () => {
  for (const [file, text] of allText()) {
    assert.doesNotMatch(text, /data-af-id="meta"/, file);
    for (const marker of text.matchAll(/data-af="([^"]+)"/g))
      assert.ok(["meta", "design-system", "core", "state"].includes(marker[1]!), `${file}: data-af="${marker[1]}"`);
  }
  for (const { page } of examples) assert.match(skillFile(page), /<script type="application\/json" data-af="meta">/, page);
});

test("each example page passes check.mjs's checks, links its backend by name and follows the skill's conventions", async () => {
  const { checkPage } = await load<PageModelModule>("src/page/page-model.ts");
  assert.deepEqual(
    skillFiles("examples").filter((f) => f.endsWith(".html")),
    examples.map((e) => e.page.slice("examples/".length)).sort(),
    "every example page is held to these checks",
  );
  for (const { page, backend, name } of examples) {
    const html = skillFile(page);
    assert.deepEqual(checkPage(html), [], page);
    const link = new RegExp(`<link rel="af-backend" href="${DEFAULT_AF_ORIGIN}/af/v1/ids/([A-Za-z0-9]{6})" data-af-name="([a-z]+)">`).exec(html);
    assert.ok(link, `${page} links its backend by ID`);
    assert.equal(link[2], name, page);
    assert.match(html, /^<html lang="en"(?: data-af-design-system="[a-z]+")?>$/m, `${page} sets only the design system on <html>`);
    assert.doesNotMatch(html, /data-af-dark/, `${page} leaves data-af-dark to the core`);
    assert.doesNotMatch(html, /importmap/, page);
    assert.match(html, /li\.dataset\.afId = /, `${page} gives generated rows a data-af-id`);
    assert.match(html, /client\.(watchQuery|updateQuery)/, `${page} keeps its state through client`);
    assert.match(html, /extensions\?\.outcomes/, `${page} reads its mutation outcomes`);
    assert.ok(html.includes(`'${name}.`), `${page} names outcome paths under its backend's name`);
    // The backend's schema reads without running it, and every field it declares resolves through the file's default export.
    const deployment = await compileOnlyHost().compile(skillFile(backend));
    assert.ok(deployment.fields.length >= 2, backend);
  }
});

test("every platform URL in the skill is a real /af/v1/, /a/ or /@ address on a known origin", () => {
  const fileId = (value: string) => value === "<id>" || FILE_ID_PATTERN.test(value);
  // Pages written against an earlier default host keep working: the server rewrites every known origin on save.
  const origins = KNOWN_AF_ORIGINS.map((origin) => origin.replace(/[.]/g, "\\."));
  const platformUrl = new RegExp(`(${origins.join("|")})/(?:af\\/v1\\/|a\\/|@)[^\\s"'\`)]*`, "g");
  let pages = 0;
  for (const [file, text] of allText())
    for (const [url, origin] of text.matchAll(platformUrl)) {
      const path = url.slice(`${origin}/`.length);
      const platform = /^af\/v1\/(.+)$/.exec(path)?.[1];
      const page = /^a\/([^/-]+)(?:-[^/]*)?$/.exec(path)?.[1];
      const library = /^@([^/]+)\/(.+)$/.exec(path);
      if (page) pages++;
      assert.ok(
        platform === "core.js" ||
          (platform?.startsWith("ids/") && fileId(platform.slice("ids/".length))) ||
          (platform?.startsWith("design-systems/") &&
            (DESIGN_SYSTEMS as readonly string[]).includes(platform.slice("design-systems/".length).replace(/\.css$/, ""))) ||
          (page && fileId(page)) ||
          (library && library[1] && library[2] && !/(?:^|\/)\.\.?(?:\/|$)/.test(library[2])),
        `${file}: ${url}`,
      );
    }
  assert.ok(pages >= 2, "the skill shows the canonical page address");
});

test("the skill names the default server everywhere, and an earlier default stays a known origin", () => {
  assert.ok(LEGACY_AF_ORIGINS.every((origin) => KNOWN_AF_ORIGINS.includes(origin) && origin !== DEFAULT_AF_ORIGIN));
  for (const file of ["SKILL.md", "references/scripts.md", "references/http-api.md", ...examples.map((e) => e.page)]) {
    const text = skillFile(file);
    assert.ok(text.includes(DEFAULT_AF_ORIGIN), `${file} names ${DEFAULT_AF_ORIGIN}`);
    for (const legacy of LEGACY_AF_ORIGINS) assert.ok(!text.includes(legacy + "/") && !text.includes(legacy + "`"), `${file} still names ${legacy}`);
  }
  assert.match(skillFile("SKILL.md"), new RegExp(`\`AF_SERVER\` \\(default \`${DEFAULT_AF_ORIGIN.replace(/[.]/g, "\\.")}\`\\)`));
});

test("references/http-api.md documents every POST /api/paths operation the server accepts", () => {
  const contract = readFileSync(repositoryPath("src/contracts.ts"), "utf8");
  const union = /export type PathChange =([\s\S]*?);\n/.exec(contract)![1]!;
  const kinds = [...union.matchAll(/kind: "([a-z-]+)"/g)].map((m) => m[1]!) as PathChange["kind"][];
  assert.ok(kinds.length >= 4, "the contract lists the operations");
  const paths = skillFile("references/http-api.md").split("## Paths")[1]!.split("\n## ")[0]!;
  for (const kind of kinds) assert.ok(paths.includes(`"kind": "${kind}"`), `POST /api/paths { "kind": "${kind}" } is documented`);
  for (const field of ['"from"', '"paths"', '"destination"']) assert.ok(paths.includes(field), `${field} is documented`);
  assert.doesNotMatch(paths, /A move or rename \|/, "the body is spelled out, not summarised");
});

test("each design system file exists, opens with its description and defines the standard variables in light and dark", () => {
  assert.deepEqual(skillFiles("design-systems"), DESIGN_SYSTEMS.map((n) => `${n}.css`).sort());
  for (const name of DESIGN_SYSTEMS) {
    const css = skillFile(`design-systems/${name}.css`);
    assert.match(css, new RegExp(`^/\\*\\n \\* design-systems/${name}\\.css`), name);
    assert.ok(css.includes(`The core loads this file when <html data-af-design-system="${name}">.`), name);
    assert.ok(css.includes(`:root[data-af-design-system="${name}"]`), name);
    assert.match(css, /data-af-dark="true"/, name);
    for (const variable of ["--background", "--foreground", "--primary", "--primary-foreground", "--card", "--border", "--radius", "--font-sans"])
      assert.ok(css.includes(`${variable}:`), `${name} ${variable}`);
  }
});

/** Faces installed with macOS, iOS, Windows, Android or common Linux desktops, and CSS generic families. */
const SYSTEM_FONTS = new Set(
  [
    "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
    "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Helvetica", "Arial", "Arial Narrow", "Arial Black",
    "Arial Rounded MT Bold", "Avenir Next Condensed", "Impact", "Verdana", "Tahoma", "Franklin Gothic Medium",
    "Georgia", "Times New Roman", "Times", "Iowan Old Style", "Palatino Linotype", "Palatino", "Book Antiqua",
    "Optima", "Trajan Pro", "Old English Text MT",
    "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "Courier New", "Courier",
  ].map((name) => name.toLowerCase()),
);

test("design systems name only fonts installed on the platforms and download none", () => {
  for (const name of DESIGN_SYSTEMS) {
    const css = skillFile(`design-systems/${name}.css`);
    assert.doesNotMatch(css, /@font-face|@import|url\(\s*["']?(?:https?:|\/)/, name);
    const stacks = [...css.matchAll(/--font-[a-z]+:\s*([^;]+);/g)].map((m) => m[1]!);
    assert.ok(stacks.length >= 2, name);
    for (const stack of stacks)
      for (const family of stack.split(",").map((part) => part.trim().replace(/^["']|["']$/g, "")))
        assert.ok(SYSTEM_FONTS.has(family.toLowerCase()), `${name}: ${family} is not installed on the platforms`);
    assert.match(css, /^ \* Fonts: installed system faces only/m, name);
  }
});

test("every endpoint in references/http-api.md is in the server's route contract", () => {
  const contract = readFileSync(repositoryPath("src/server/af-api-contracts.ts"), "utf8");
  const routes = new Set([...contract.matchAll(/^ \*\s+(GET|HEAD|POST|PUT|DELETE)\s+(\/\S+)/gm)].map((m) => `${m[1]} ${m[2]}`));
  const documented = [...skillFile("references/http-api.md").matchAll(/^\| `(GET|HEAD|POST|PUT|DELETE) (\/[^`]+)`/gm)].map((m) => `${m[1]} ${m[2]}`);
  assert.ok(documented.length >= 14);
  for (const route of documented) assert.ok(routes.has(route), route);
});

test("a harness can hand an agent a server and token through AF_SERVER and AF_TOKEN", () => {
  for (const file of ["SKILL.md", "references/http-api.md", "references/scripts.md"]) {
    assert.match(skillFile(file), /AF_SERVER/, file);
    assert.match(skillFile(file), /AF_TOKEN/, file);
  }
});

test("every file the References section names exists", () => {
  const references = skillFile("SKILL.md").split("## References")[1] ?? "";
  const named = [...references.matchAll(/`([\w./<>-]+\.(?:md|css|html|mjs))`/g)].map((m) => m[1]!);
  for (const script of ["scripts/add.mjs", "scripts/check.mjs", "scripts/shot.mjs", "scripts/publish.mjs", "scripts/comments.mjs"]) assert.ok(named.includes(script), script);
  for (const file of named)
    if (!file.includes("<")) assert.ok(existsSync(repositoryPath(`${SKILL_ROOT}/${file}`)), file);
});

test("author publishing contract states backend quotas, returned IDs and independent failure limits", () => {
  const http = skillFile("references/http-api.md");
  for (const file of ["SKILL.md", "references/backend.md", "references/http-api.md"]) {
    const text = skillFile(file);
    for (const bound of ["64", "262,144", "1,048,576"]) assert.ok(text.includes(bound), `${file}: ${bound}`);
    assert.doesNotMatch(text, /any number of backend files|any number of them/);
  }
  assert.match(http, /Each linked backend's `name`, `id`, `version` and `typeDefs`/);
  assert.match(http, /4,000,000 UTF-16 characters[^\n]*413[^\n]*files are too large/);
  assert.match(http, /count[^\n]*1[^\n]*100/);
  assert.match(http, /400[^\n]*Idempotency-Key/);
  assert.match(http, /422[^\n]*another count/);
  assert.match(http, /requestId[^\n]*200/);
  assert.match(http, /409[^\n]*files: <id> was published by another request/);
  assert.match(http, /503[^\n]*backend[^\n]*compil/);
});

test("author permissions distinguish anonymous public reads from management and document upload retry grammar", () => {
  const http = skillFile("references/http-api.md");
  assert.match(http, /private or unlisted[^\n]*403/);
  assert.match(http, /public page[^\n]*read routes[^\n]*anonymous/i);
  for (const file of ["references/http-api.md", "references/scripts.md"])
    assert.match(skillFile(file), /owner, or an active editor of an imported group page/);
  assert.match(http, /1 to 200 printable ASCII characters[^\n]*leading or trailing spaces/);
  assert.ok(http.includes("`^[A-Za-z0-9_.-]{8,120}$`"));
  assert.match(http, /attachment[^\n]*8 to 120[^\n]*400/);
});

test("author route tables expose trash, installation, public profiles and protected image reads", () => {
  const routes = new Set([...skillFile("references/http-api.md").matchAll(/^\| `(GET|HEAD|POST|PUT|DELETE) (\/[^`]+)`/gm)].map((m) => `${m[1]} ${m[2]}`));
  for (const route of [
    "GET /api/trash", "POST /api/trash/folders", "POST /api/trash/:id/restore",
    "GET /skills/pagegi-author.tgz", "GET /skills/artefactbin-skill.tgz", "GET /install.sh",
    "GET /@<handle>", "HEAD /@<handle>",
    ...["GET", "HEAD"].flatMap((method) => [
      `${method} /api/files/:id/comments/:commentId/attachments/:attachmentId/:variant`,
      `${method} /af/v1/ids/:id/person-images/:valueName/:opaqueAssetId`,
    ]),
  ]) assert.ok(routes.has(route), `missing author-facing route: ${route}`);
});
