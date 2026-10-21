/**
 * shot.mjs: a screenshot of the page in Chrome, run with the live core from
 * AF_SERVER when it answers, else as a static copy with the design system's CSS.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AF_CORE_PATH, AF_DESIGN_SYSTEM_PATH, AF_SERVER_ENV, DEFAULT_AF_ORIGIN, DEFAULT_DESIGN_SYSTEM, type AfJson } from "../af-contracts.ts";
import { PREVIEW_DARK_PARAMETER, PREVIEW_DESIGN_SYSTEM_PARAMETER } from "../browser/core/appearance.ts";
import type { PageModelModule } from "../page/page-contracts.ts";
import * as pageModel from "../page/page-model.ts";
import type { AfCommand, AfIo } from "./af-contracts.ts";
import { screenshot } from "./chrome.ts";
import { ExitError, readPage } from "./command-io.ts";
import { liveShotPage, shotPage } from "./shot-page.ts";
import { stateAddress } from "./state-url.ts";

const model: PageModelModule = pageModel;

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/opt/google/chrome/chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

function findChrome(env: AfIo["env"]): string {
  const configured = env.CHROME_PATH;
  if (configured) {
    if (existsSync(configured)) return configured;
    throw new ExitError(2, `Chrome not found at CHROME_PATH=${configured}. shot needs Chrome or Chromium; set CHROME_PATH to its executable.`);
  }
  const home = env.HOME;
  const candidates = home ? [...CHROME_PATHS, join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")] : CHROME_PATHS;
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new ExitError(2, "shot needs Chrome or Chromium, and none was found in the standard install paths. Set CHROME_PATH to its executable.");
  return found;
}

/** Whether `${server}/af/v1/core.js` answers, within a few seconds. */
async function coreReachable(server: string): Promise<boolean> {
  try {
    const response = await fetch(server + AF_CORE_PATH, { signal: AbortSignal.timeout(4_000) });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

/** shot --state: the JSON file's value. */
async function readState(io: AfIo, file: string): Promise<AfJson> {
  let text: string;
  try {
    text = await readFile(resolve(io.cwd, file), "utf8");
  } catch {
    throw new ExitError(2, `Cannot read ${file}: no such file.`);
  }
  try {
    return JSON.parse(text) as AfJson;
  } catch {
    throw new ExitError(2, `${file} is not valid JSON. --state takes a JSON file of the page's local state.`);
  }
}

export async function shot(command: Extract<AfCommand, { kind: "shot" }>, io: AfIo): Promise<number> {
  const file = resolve(io.cwd, command.file);
  const source = await readPage(io, command.file);
  const state = command.state ? await readState(io, command.state) : undefined;
  const chrome = findChrome(io.env);
  const server = (io.env[AF_SERVER_ENV] || DEFAULT_AF_ORIGIN).replace(/\/+$/, "");
  const baseHref = pathToFileURL(dirname(file) + "/").href;
  let copy: string;
  // The core applies the requested appearance from these preview parameters.
  const query = new URLSearchParams({ [PREVIEW_DARK_PARAMETER]: command.dark ? "1" : "0" });
  if (command.designSystem) query.set(PREVIEW_DESIGN_SYSTEM_PARAMETER, command.designSystem);
  if (await coreReachable(server)) copy = liveShotPage(source, { server, baseHref });
  else {
    // No core: scripts that import @afbin/apollo won't run, so only static content shows.
    const designSystem = command.designSystem ?? model.parsePage(source).designSystem ?? DEFAULT_DESIGN_SYSTEM;
    // The skill's own copy beside scripts/, else the published one.
    const localCss = io.scriptUrl && fileURLToPath(new URL(`../design-systems/${designSystem}.css`, io.scriptUrl));
    const cssHref = localCss && existsSync(localCss) ? pathToFileURL(localCss).href : `${DEFAULT_AF_ORIGIN}${AF_DESIGN_SYSTEM_PATH}${designSystem}.css`;
    io.stderr(
      `Note: could not reach ${server}${AF_CORE_PATH}, so this screenshot is without the core: ` +
        `scripts that import @afbin/apollo don't run and only the page's static content shows. ` +
        `Set AF_SERVER to a reachable Pagegi server for a full screenshot.\n`,
    );
    copy = shotPage(source, { designSystem, dark: command.dark, cssHref, baseHref });
  }
  const out = resolve(io.cwd, command.out);
  const work = await mkdtemp(join(tmpdir(), "af-shot-"));
  try {
    const page = join(work, "page.html");
    await writeFile(page, copy);
    await rm(out, { force: true });
    const url = pathToFileURL(page);
    url.search = query.toString();
    if (state !== undefined) url.hash = stateAddress("", state).slice(1);
    const { png } = await screenshot({
      chrome,
      url: url.href,
      width: command.width,
      height: command.width <= 600 ? 844 : 800,
      profile: join(work, "profile"),
    }).catch((error: Error) => {
      throw new ExitError(2, `Chrome did not save a screenshot: ${error.message}`);
    });
    await writeFile(out, png);
    io.stdout(`${command.out}\n`);
    return 0;
  } finally {
    await rm(work, { recursive: true, force: true, maxRetries: 5 });
  }
}
