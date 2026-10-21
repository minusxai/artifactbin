import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { repositoryPath } from "../support/load.ts";
import { skillFile } from "../support/skill.ts";
import { startServer } from "../support/server.ts";

function run(args: string[], cwd: string, env: Record<string, string>) {
  return new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [repositoryPath("skills/pagegi-author/scripts/shot.mjs"), ...args], {
      cwd,
      env: { PATH: process.env.PATH ?? "", HOME: cwd, ...env },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}
const pngWidth = (png: Buffer) => png.readUInt32BE(16);
/** Nowhere: a port nothing listens on, so shot falls back to a static copy. */
const UNREACHABLE = "http://127.0.0.1:9";

/** RGB of the pixel at (x, y), read by a browser. */
async function pixels(png: Buffer, points: [number, number][]): Promise<number[][]> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    return await page.evaluate(
      async ({ data, points }) => {
        const image = new Image();
        image.src = "data:image/png;base64," + data;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)]);
      },
      { data: png.toString("base64"), points },
    );
  } finally {
    await browser.close();
  }
}

test("shot saves a PNG at the requested width, in dark mode, with a design system", async () => {
  const dir = mkdtempSync(join(tmpdir(), "af-shot-"));
  try {
    writeFileSync(join(dir, "page.html"), skillFile("examples/todo.html"));
    const result = await run(
      ["page.html", "--width", "390", "--dark", "--design-system", "dossier", "--out", "phone-dark.png"],
      dir,
      { CHROME_PATH: chromium.executablePath(), AF_SERVER: UNREACHABLE },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /could not reach http:\/\/127\.0\.0\.1:9\/af\/v1\/core\.js/);
    const png = readFileSync(join(dir, "phone-dark.png"));
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(pngWidth(png), 390);
    const fallback = await run(["page.html"], dir, { CHROME_PATH: chromium.executablePath(), AF_SERVER: UNREACHABLE });
    assert.equal(fallback.code, 0, fallback.stderr);
    assert.equal(pngWidth(readFileSync(join(dir, "shot.png"))), 1280);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shot runs the page with the live core from AF_SERVER and its preview appearance", async () => {
  const server = await startServer();
  const dir = mkdtempSync(join(tmpdir(), "af-shot-"));
  try {
    writeFileSync(
      join(dir, "page.html"),
      `<!DOCTYPE html>
<html>
<head>
  <script src="https://artifactbin.dev/af/v1/core.js"></script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; }
    #mode { position: fixed; left: 0; top: 0; width: 100px; height: 100px; background: rgb(255, 255, 255); }
    html[data-af-dark="true"] #mode { background: rgb(0, 0, 0); }
    #module { position: fixed; right: 0; top: 0; width: 100px; height: 100px; background: rgb(0, 0, 255); }
  </style>
</head>
<body>
  <div id="mode"></div>
  <div id="module"></div>
  <script type="module">
    import { client, gql } from '@afbin/apollo';
    await client.updateQuery({ query: gql\`{ ready }\` }, () => ({ ready: true }));
    document.querySelector('#module').style.background = 'rgb(255, 0, 0)';
  </script>
</body>
</html>
`,
    );
    const env = { CHROME_PATH: chromium.executablePath(), AF_SERVER: server.origin };
    const dark = await run(["page.html", "--width", "390", "--dark", "--out", "dark.png"], dir, env);
    assert.equal(dark.code, 0, dark.stderr);
    assert.doesNotMatch(dark.stderr, /could not reach/);
    const darkPng = readFileSync(join(dir, "dark.png"));
    assert.equal(pngWidth(darkPng), 390);
    assert.deepEqual(await pixels(darkPng, [[50, 50], [340, 50]]), [
      [0, 0, 0],
      [255, 0, 0],
    ], "dark mode from ?af-dark=1, and the page's module ran with @afbin/apollo");
    const light = await run(["page.html", "--width", "390", "--out", "light.png"], dir, env);
    assert.equal(light.code, 0, light.stderr);
    assert.deepEqual((await pixels(readFileSync(join(dir, "light.png")), [[50, 50]]))[0], [255, 255, 255]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await server.close();
  }
});

test("shot reports a Chrome that dies at once with Chrome's own message, not a crash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "af-shot-"));
  try {
    writeFileSync(join(dir, "page.html"), skillFile("examples/todo.html"));
    const fake = join(dir, "fake-chrome");
    writeFileSync(fake, "#!/bin/sh\necho 'Running as root without --no-sandbox is not supported.' >&2\nexit 1\n", { mode: 0o755 });
    const result = await run(["page.html"], dir, { CHROME_PATH: fake, AF_SERVER: UNREACHABLE });
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stderr, /Chrome exited \(1\)[\s\S]*--no-sandbox/);
    assert.doesNotMatch(result.stderr, /ECONNRESET|EPIPE|Unhandled/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shot without Chrome exits 2 and says what it needs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "af-shot-"));
  try {
    writeFileSync(join(dir, "page.html"), skillFile("examples/todo.html"));
    const result = await run(["page.html"], dir, { CHROME_PATH: join(dir, "missing-chrome"), PATH: dir });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Chrome/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
