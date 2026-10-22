/** Actual installed example scripts + Apollo, with an injected backend/invalidation boundary. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

declare global {
  interface Window {
    exampleStatus: {
      calls(): number;
      refresh(): void;
      reply(kind: "denied" | "success"): void;
    };
    authoredIntervals: number[];
    probe: {
      calls(): number;
      listeners(): number;
      state(): Record<string, unknown>;
      rows(next: { id: string; text: string; done: boolean }[]): void;
      outcome(next: string): void;
    };
  }
}

for (const [example, namespace] of [
  ["todo", "team"],
  ["notes", "notes"],
])
  test(`${example}: remote watch, reconnect and disposal without polling or local mirrors`, async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const source = readFileSync(
        `skills/pagegi-author/examples/${example}.html`,
        "utf8",
      );
      const script = /<script type="module">([\s\S]*?)<\/script>/.exec(
        source,
      )![1]!;
      await page.setContent(source.replace(/<script[\s\S]*?<\/script>/g, ""));
      const bundle = await build({
        stdin: {
          resolveDir: process.cwd(),
          contents: `
   import {createClient,createLocalStore,gql} from './src/apollo/client.ts';
   const listeners=new Set();let rows=[];let calls=0;let outcome='committed';
   const store=createLocalStore({draft:'',filter:'all',search:''});
   const remote={online:()=>true,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},async execute(request){calls++;
    const ns=${JSON.stringify(namespace)};
    if(request.operation==='mutation'){
     if(outcome==='committed')rows=[...rows,{id:String(rows.length+1),text:request.variables.text,done:false}];
     return {data:{[ns]:{add:{id:String(rows.length)}}},extensions:{outcomes:{[ns+'.add']:outcome}}};
    }
    return {data:{[ns]:{viewer:'synthetic',list:rows}}};
   }};
   const client=createClient({state:store,backends:[${JSON.stringify(namespace)}],remote});
   window.api={client,gql};window.probe={rows(next){rows=next;for(const fn of listeners)fn()},state:()=>store.read(),calls:()=>calls,listeners:()=>listeners.size,outcome(next){outcome=next}};
   window.authoredIntervals=[];window.setInterval=(...args)=>{authoredIntervals.push(args[1]);return 1};
  `,
        },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
      });
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.addScriptTag({
        type: "module",
        content: script.replace(
          "import { gql, client } from '@afbin/apollo';",
          "const {gql,client}=window.api;",
        ),
      });
      await page.waitForFunction(() => window.probe.calls() > 0);
      assert.deepEqual(
        await page.evaluate(() => window.authoredIntervals),
        [],
        "author scripts do not install polling",
      );
      await page.evaluate(() =>
        window.probe.rows([{ id: "1", text: "Server update", done: false }]),
      );
      await page.getByText("Server update", { exact: true }).waitFor();
      const state = await page.evaluate(() => window.probe.state());
      assert.equal(Object.hasOwn(state, "todos"), false);
      assert.equal(Object.hasOwn(state, "loaded"), false);
      assert.equal(Object.hasOwn(state, "signedIn"), false);
      // Reconnect is a fresh authoritative invalidation, not an authored refetch timer.
      await page.evaluate(() =>
        window.probe.rows([{ id: "2", text: "After reconnect", done: false }]),
      );
      await page.getByText("After reconnect", { exact: true }).waitFor();
      assert.equal(
        await page.getByText("Server update", { exact: true }).count(),
        0,
      );
      // A committed write refreshes the remote view and clears only the local draft.
      await page.locator("#text").fill("Committed write");
      await page.locator("#new button").click();
      await page.getByText("Committed write", { exact: true }).waitFor();
      assert.equal(await page.locator("#text").inputValue(), "");
      const active = await page.evaluate(() => window.probe.listeners());
      await page.evaluate(() =>
        dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
      );
      assert.equal(
        await page.evaluate(() => window.probe.listeners()),
        active,
        "BFCache keeps active watches",
      );
      await page.locator("#text").fill("Uncertain write");
      await page.evaluate(() => window.probe.outcome("unknown"));
      await page.locator("#new button").click();
      await page
        .locator("#status")
        .filter({ hasText: /unknown|could not confirm/i })
        .waitFor();
      assert.equal(await page.locator("#text").inputValue(), "Uncertain write");
      const mutationCalls = await page.evaluate(() => window.probe.calls());
      await page.evaluate(() => window.probe.rows([]));
      await page.waitForFunction(
        (before) => window.probe.calls() > before,
        mutationCalls,
      );
      assert.match(
        await page.locator("#status").innerText(),
        /unknown|could not confirm/i,
      );
      await page.evaluate(() =>
        dispatchEvent(
          new PageTransitionEvent("pagehide", { persisted: false }),
        ),
      );
      assert.equal(await page.evaluate(() => window.probe.listeners()), 0);
      const before = await page.evaluate(() => window.probe.calls());
      await page.evaluate(() =>
        window.probe.rows([{ id: "3", text: "Disposed", done: false }]),
      );
      assert.equal(await page.evaluate(() => window.probe.calls()), before);
    } finally {
      await browser.close();
    }
  });

test("todo: absent backend, pending read and revoked access have distinct authoritative states", async () => {
  const browser = await chromium.launch();
  const source = readFileSync(
    "skills/pagegi-author/examples/todo.html",
    "utf8",
  );
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(source)![1]!;
  try {
    for (const declared of [false, true]) {
      const page = await browser.newPage();
      const markup = source.replace(/<script[\s\S]*?<\/script>/g, "");
      await page.setContent(
        declared ? markup : markup.replace(/<link rel="af-backend"[^>]*>/, ""),
      );
      const bundle = await build({
        stdin: {
          resolveDir: process.cwd(),
          contents: `
        import {createClient,createLocalStore,gql} from './src/apollo/client.ts';
        let calls=0,settle;const listeners=new Set();
        const stale=[{id:'stale',text:'Stale local row',done:false}];
        const store=createLocalStore({draft:'Unsent draft',filter:'all',todos:stale,team:{list:stale}});
        const remote={online:()=>true,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},execute(){calls++;return new Promise(resolve=>{settle=resolve})}};
        const client=createClient({state:store,backends:${declared ? "['team']" : "[]"},remote});
        window.api={client,gql};window.exampleStatus={calls:()=>calls,refresh(){for(const fn of listeners)fn()},reply(kind){settle(kind==='denied'?{data:{team:null},errors:[{message:'Access denied',path:['team']}]}:{data:{team:{list:[{id:'fresh',text:'Fresh authorized row',done:false}]}}})}};
      `,
        },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
      });
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.addScriptTag({
        type: "module",
        content: script.replace(
          "import { gql, client } from '@afbin/apollo';",
          "const {gql,client}=window.api;",
        ),
      });
      await page
        .locator('#filters button[data-filter="all"][aria-pressed="true"]')
        .waitFor();
      assert.equal(await page.inputValue("#text"), "Unsent draft");
      if (!declared) {
        assert.equal(
          await page.locator("#read-status").textContent(),
          "Shared list unavailable. Connect or check your access.",
        );
        assert.equal(
          await page.evaluate(() => window.exampleStatus.calls()),
          0,
        );
      } else {
        assert.equal(
          await page.locator("#read-status").textContent(),
          "Loading shared list…",
        );
        assert.equal(await page.locator("#list li").count(), 0);
        await page.evaluate(() => window.exampleStatus.reply("success"));
        await page.getByText("Fresh authorized row", { exact: true }).waitFor();
        assert.equal(await page.locator("#read-status").textContent(), "");
        await page.evaluate(() => window.exampleStatus.refresh());
        await page.waitForFunction(() => window.exampleStatus.calls() === 2);
        await page.evaluate(() => window.exampleStatus.reply("denied"));
        await page
          .getByText("Shared list unavailable. Connect or check your access.")
          .waitFor();
      }
      assert.equal(
        await page.locator("#list li").count(),
        0,
        "missing/revoked shared data cannot be replaced by local mirrors",
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
