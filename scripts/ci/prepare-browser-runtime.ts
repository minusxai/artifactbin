import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";
import { setupRequirements } from "./inventory.ts";
import { browserRuntimePlan, provisionBrowserRuntime } from "./browser-runtime.ts";
const [kind = "validate", shard = "0", total = "4", engine = "chromium"] = process.argv.slice(2);
const plan = browserRuntimePlan(setupRequirements(kind, Number(shard), Number(total), engine).browsers);
const { version } = JSON.parse(readFileSync("node_modules/playwright/package.json", "utf8")) as { version: string };
const run = (args: string[]): Promise<void> => new Promise((resolve, reject) => {
  const child = args[0] === "image"
    ? spawn("docker", ["pull", "mcr.microsoft.com/playwright:v1.56.1-noble"], { stdio: "inherit" })
    : spawn(process.execPath, ["node_modules/playwright/cli.js", ...args], { stdio: "inherit" });
  child.on("error", reject);
  child.on("exit", code => code === 0 ? resolve() : reject(Error(`Browser setup exited ${code}`)));
});
await provisionBrowserRuntime(plan, version, {
  run,
  async smoke(engine) {
    const browser = await ({ chromium, firefox, webkit })[engine].launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent("<title>CI browser dependency proof</title>");
      if (await page.title() !== "CI browser dependency proof") throw Error(`${engine} dependency proof failed`);
    } finally { await browser.close(); }
    console.log(`${engine} native dependency proof passed`);
  },
});
