import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { convertNativeProgramPage } from "../src/migration/programs/native-page.ts";
test("generated native program page validates JSON, shows pending, preserves output on denial and fits mobile", async () => {
  const converted = await convertNativeProgramPage({
    source: JSON.stringify({
      version: 1,
      command: ["node", "-e", "console.log(process.env.ARTIFACTBIN_INPUT)"],
      compute: { vcpu: 1, memoryMiB: 2048, ttlSeconds: 60 },
    }),
    coreUrl: "/af/v1/core.js",
    title: "Program workbench",
    binding: {
      backendNamespace: "legacyData",
      backendHref: "/af/v1/ids/Bk0001",
    },
  });
  assert.ok(converted.html);
  const html = converted.html;
  const authored = /<script type="module">([\s\S]*?)<\/script>/.exec(html)![1]!;
  const initial = JSON.parse(
    /<script type="application\/json" data-af="state">([\s\S]*?)<\/script>/.exec(
      html,
    )![1]!,
  );
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import {createClient,createLocalStore,gql} from './src/apollo/client.ts';
const state=createLocalStore(${JSON.stringify(initial)});let calls=0,pending;
const client=createClient({state,backends:['legacyData'],remote:{online:()=>true,subscribe:()=>()=>{},execute:request=>{calls++;return new Promise(resolve=>pending=resolve);}}});
window.nativeProbe={calls:()=>calls,reply(kind){if(kind==='success')pending({data:{legacyData:{run:JSON.stringify({stdout:'Completed output\\n',stderr:'',exitCode:0})}},extensions:{outcomes:{'legacyData.run':'committed'}}});else pending({data:{legacyData:{run:null}},errors:[{message:'denied'}],extensions:{outcomes:{'legacyData.run':'rejected'}}});}};
${authored.replace("import {gql,client} from '@afbin/apollo';", "")}
`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 760 },
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent(html.replace(/<script[\s\S]*?<\/script>/g, ""));
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const input = page.getByRole("textbox", { name: "JSON input" }),
      button = page.getByRole("button", { name: "Run program" }),
      output = page.getByLabel("Program output");
    await input.fill("{bad");
    await button.click();
    await page
      .getByRole("status")
      .filter({ hasText: "Enter valid JSON" })
      .waitFor();
    assert.equal(
      await page.evaluate(() => (window as any).nativeProbe.calls()),
      0,
    );
    assert.equal(await input.getAttribute("aria-invalid"), "true");
    await input.fill('{"item":1}');
    await button.click();
    await page.getByRole("button", { name: "Running…" }).waitFor();
    assert.equal(await button.count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "Running…" }).isDisabled(),
      true,
    );
    await page.evaluate(() => (window as any).nativeProbe.reply("success"));
    await page
      .getByRole("status")
      .filter({ hasText: "Finished with exit code 0" })
      .waitFor();
    assert.equal(await output.textContent(), "Completed output\n");
    await input.fill("invalid");
    await button.click();
    await page
      .getByRole("status")
      .filter({ hasText: "Enter valid JSON" })
      .waitFor();
    assert.equal(await output.textContent(), "Completed output\n");
    assert.equal(
      await page.evaluate(() => (window as any).nativeProbe.calls()),
      1,
    );
    await input.fill("null");
    await button.click();
    await page.getByRole("button", { name: "Running…" }).waitFor();
    assert.equal(await output.textContent(), "Completed output\n");
    await page.evaluate(() => (window as any).nativeProbe.reply("denied"));
    await page
      .getByRole("status")
      .filter({ hasText: "signed in as the owner" })
      .waitFor();
    assert.equal(await output.textContent(), "Completed output\n");
    assert.equal(await button.isEnabled(), true);
    await page.screenshot({ path: "/tmp/native-program-desktop.png" });
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: "/tmp/native-program-mobile.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
