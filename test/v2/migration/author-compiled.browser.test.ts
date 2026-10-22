import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { compileAuthorScript } from "../../../src/migration/conversion/compiled/author/compiler.ts";
const archivedRoot = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "offline authored Solid mounts ordinary nodes using Apollo state from core",
  { skip: !archivedRoot },
  async () => {
    const compiled = await compileAuthorScript(
      `import {signal} from 'page';import {createSignal} from 'solid-js';export function Counter(){const [n,set]=signal('$count');const [local,put]=createSignal([{n:1}],{name:'local'});return <button onClick={()=>{set(v=>v+1);put(items=>items.map(item=>({n:item.n+1})))}}>{n()}:{local()[0].n}</button>}`,
      { values: ["count"], queries: [], mutations: [] },
      { archivedRoot: archivedRoot! },
    );
    const portsModule = (
      await build({
        entryPoints: [
          fileURLToPath(
            new URL(
              "../../../src/migration/conversion/compiled/author/apollo-ports.ts",
              import.meta.url,
            ),
          ),
        ],
        bundle: true,
        write: false,
        format: "esm",
      })
    ).outputFiles[0]!.text;
    const core = await readFile(
      new URL("../../../dist/core.js", import.meta.url),
      "utf8",
    );
    const errors: string[] = [];
    const html = `<!doctype html><html><head><script src="/af/v1/core.js"></script><script type="application/json" data-af="state">{"compiledPage":{"count":2}}</script></head><body><div id="mount"></div><script type="module">
 import {client,gql} from '@afbin/apollo';import {createAuthorModule} from '/author.js';import {authorApolloPorts} from '/ports.js';
 const query=gql\`{compiledPage authorSignals}\`;
 const ports=authorApolloPorts(client,query,()=>{throw Error('undeclared')});
 await createAuthorModule().mount(ports,[{element:document.querySelector('#mount'),identity:'counter',component:'Counter'}]);
 </script></body></html>`;
    const server = createServer((req, res) => {
      res.setHeader(
        "Content-Type",
        req.url?.endsWith(".js") ? "text/javascript" : "text/html",
      );
      res.end(
        req.url === "/af/v1/core.js"
          ? core
          : req.url === "/author.js"
            ? compiled.code
            : req.url === "/ports.js"
              ? portsModule
              : html,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      page.setDefaultTimeout(5000);
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      );
      await page.getByRole("button", { name: "2:1", exact: true }).waitFor();
      await page.getByRole("button").click();
      await page.getByRole("button", { name: "3:2", exact: true }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: "3:2", exact: true }).waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test(
  "Solid owner scopes survive delayed branches and throwing cleanups drain all ownership",
  { skip: !archivedRoot },
  async () => {
    const compiled = await compileAuthorScript(
      `import {createSignal,Show,onCleanup} from 'solid-js';import {query} from 'page';
 const [shared,setShared]=createSignal(5,{name:'module'});
 function Later(){const [n,set]=createSignal(0,{name:'late'});return <button onClick={()=>set(v=>v+1)}>late:{n()}</button>}
 export function Delayed(){const [show,set]=createSignal(false);return <div><button onClick={()=>set(v=>!v)}>toggle</button><Show when={show()}><Later/></Show><button onClick={()=>setShared(v=>v+1)}>module:{shared()}</button></div>}
 export function Cleanup(props){const [n,set]=createSignal(0,{name:'cleanup'});props.accept(query('$rows').ready);onCleanup(()=>{set(v=>v+1);if(props.fail)throw Error('authored cleanup failed')});return <p>cleanup:{n()}</p>}
 export function Fail(){throw Error('authored mount failed')}
 `,
      { values: [], queries: ["rows"], mutations: [] },
      { archivedRoot: archivedRoot! },
    );
    const html = `<!doctype html><div id="first"></div><div id="second"></div><div id="cleanup1"></div><div id="cleanup2"></div><script type="module">
 import {createAuthorModule} from '/author.js';
 const values=new Map();let subscriptions=0;const listeners=new Set();const waits=[];
 const state={read:key=>values.get(key),write(key,value){values.set(key,value);for(const fn of listeners)fn()},subscribe(fn){listeners.add(fn);subscriptions++;return()=>{listeners.delete(fn);subscriptions--}}};
 const ports={state,query:()=>({read:()=>({rows:[],loading:true,error:null}),subscribe(){subscriptions++;return()=>subscriptions--}})};
 const mounts=[['first','Delayed'],['second','Delayed'],['cleanup1','Cleanup'],['cleanup2','Cleanup']].map(([id,component])=>({identity:id,component,element:document.getElementById(id),props:{fail:id==='cleanup1',accept:promise=>waits.push(promise)}}));
 const stop=await createAuthorModule().mount(ports,mounts);
 window.finish=async()=>{let threw=false;try{stop()}catch(error){threw=error instanceof AggregateError}const settled=await Promise.allSettled(waits);return {threw,subscriptions,rejected:settled.every(item=>item.status==='rejected'),values:Object.fromEntries(values)}};
 window.catchPath=async()=>{let failed=false;const pending=[];try{await createAuthorModule().mount(ports,[{identity:'catch-cleanup',component:'Cleanup',element:document.createElement('div'),props:{fail:true,accept:p=>pending.push(p)}},{identity:'fail',component:'Fail',element:document.createElement('div')}])}catch{failed=true}return {failed,subscriptions,rejected:(await Promise.allSettled(pending)).every(item=>item.status==='rejected')}};
 </script>`;
    const server = createServer((req, res) => {
      res.setHeader(
        "Content-Type",
        req.url === "/author.js" ? "text/javascript" : "text/html",
      );
      res.end(req.url === "/author.js" ? compiled.code : html);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      );
      await page
        .locator("#first")
        .getByRole("button", { name: "toggle", exact: true })
        .click();
      await page
        .locator("#first")
        .getByRole("button", { name: "late:0", exact: true })
        .click();
      await page
        .locator("#first")
        .getByRole("button", { name: "late:1", exact: true })
        .waitFor();
      await page
        .locator("#second")
        .getByRole("button", { name: "toggle", exact: true })
        .click();
      await page
        .locator("#second")
        .getByRole("button", { name: "late:0", exact: true })
        .waitFor();
      await page
        .locator("#first")
        .getByRole("button", { name: "toggle", exact: true })
        .click();
      await page
        .locator("#first")
        .getByRole("button", { name: "toggle", exact: true })
        .click();
      await page
        .locator("#first")
        .getByRole("button", { name: "late:1", exact: true })
        .waitFor();
      await page
        .locator("#first")
        .getByRole("button", { name: "module:5", exact: true })
        .click();
      await page
        .locator("#second")
        .getByRole("button", { name: "module:6", exact: true })
        .waitFor();
      const result = await page.evaluate(() => (window as any).finish());
      assert.equal(result.threw, true);
      assert.equal(result.subscriptions, 0);
      assert.equal(result.rejected, true);
      assert.equal(result.values['author:["cleanup1","cleanup"]'], 1);
      assert.equal(result.values['author:["cleanup2","cleanup"]'], 1);
      assert.deepEqual(await page.evaluate(() => (window as any).catchPath()), {
        failed: true,
        subscriptions: 0,
        rejected: true,
      });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
