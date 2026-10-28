/**
 * A SESSION OVER A FRAMED DOCUMENT, in a real worker and a real Chromium: the app page frames the document's
 * own origin with the reader's one-time ticket, that origin spends it and answers with the document and its own
 * host-only cookie, and the
 * session script's `page.evaluate(() => window.page.get(...))` reads the document's declared value — as the
 * reader the ticket named, with the pages cookie held by the parent and never by the worker's browser.
 *
 * The upstream is a stand-in for the app (server/pages-host and the app page), answering by the host the
 * request addressed exactly as the app does; the worker, its routing and its browser are the shipped ones.
 */
import { afterEach, expect, it } from 'vitest';
import {build} from 'esbuild';
import {inspectPage} from '../../app/skills/artifactbin/scripts/check.mjs';
import {fileURLToPath} from 'node:url';
import { FORWARDED_HOST, type Actor } from '@artifactbin/contracts';
import { createSessionProcess } from '../src/session-process';
import type { SessionWorker } from '../src/sessions';

const BASE = 'http://app.lvh.me:7999';
const PAGES = 'lvh.me';
const DOC = Buffer.from('doc1').toString('hex');
const DOC_ORIGIN = `http://${DOC}.${PAGES}:7999`;
const TICKET = 'ticket-0123456789abcdef';
const COOKIE = 'cookie-0123456789abcdef0123456789';

interface Seen { url: string; host: string | null; cookie: string | null; actor: Actor }

/** The app's two answers a framed read needs: the app page, and the document (which spends the ticket). */
function framingApp(seen: Seen[]) {
  let spent = false;
  return async (request: Request, actor: Actor): Promise<Response> => {
    const url = new URL(request.url);
    seen.push({ url: url.href, host: request.headers.get(FORWARDED_HOST), cookie: request.headers.get('cookie'), actor });
    const html = (body: string, headers: Record<string, string> = {}) => new Response(body, { headers: { 'content-type': 'text/html', ...headers } });
    if (url.origin === BASE && url.pathname === '/a/doc1') {
      const src = `${DOC_ORIGIN}/?_pt=${TICKET}`;
      return html(`<!doctype html><html><body><header>App bar</header><iframe data-mx-document-frame="" name="mx-document" src="${src}"></iframe></body></html>`);
    }
    if (url.origin === DOC_ORIGIN && url.pathname === '/') {
      // The ticket is spent here, in the response that serves the document, which sets this origin's host-only cookie.
      const headers: Record<string, string> = {};
      let reader = request.headers.get('cookie')?.split('; ').includes(`afbin_pages=${COOKIE}`) ? 'reader' : 'guest';
      if (url.searchParams.get('_pt') === TICKET && !spent) { spent = true; reader = 'reader'; headers['set-cookie'] = `afbin_pages=${COOKIE}; Path=/; HttpOnly; SameSite=Lax`; }
      // window.page and the ready mark arrive after the load, as the page runtime's import does.
      return html(`<!doctype html><html><body><p id="who">${reader}</p><script id="mx-story-data" type="application/json">{}</script>`
        + `<script>setTimeout(() => { window.page = Object.freeze({ get: name => name === 'count' ? (${JSON.stringify(reader)} === 'reader' ? 3 : 0) : undefined }); document.documentElement.setAttribute('data-mx-ready', ''); }, 300);</script></body></html>`, headers);
    }
    return new Response('not found', { status: 404 });
  };
}

let worker: SessionWorker | undefined;
afterEach(async () => { await worker?.close(); worker = undefined; });

it('reads window.page of the framed document as the session reader, with the pages cookie kept out of the worker', async () => {
  const seen: Seen[] = [];
  const owner: Actor = { credential: 'bearer', tokenId: 'tok_owner', userId: 'usr_owner' };
  worker = await createSessionProcess(owner, { baseURL: BASE, pagesHost: PAGES, request: framingApp(seen), sandbox: { mode: 'none' } });
  const out = await worker.run(`
    const page = await context.newPage();
    await page.goto('/a/doc1');
    // No wait of its own: evaluate resolves in the document once it has settled.
    const declared = await page.evaluate(() => typeof window.page);
    await page.waitForFunction(() => Boolean(window.page));
    return {
      declared,
      count: await page.evaluate(() => window.page.get('count')),
      who: await page.locator('#who').textContent(),
      appBar: await page.mainFrame().locator('header').textContent(),
      url: page.url(),
      cookies: await context.cookies(),
    };
  `);
  expect(out.error).toBeUndefined();
  expect(out.result).toEqual({ declared: 'object', count: 3, who: 'reader', appBar: 'App bar', url: `${BASE}/a/doc1`, cookies: [] });
  expect(out.pages.map(page => page.url)).toEqual([`${BASE}/a/doc1`]);
  const document = seen.find(entry => entry.url === `${DOC_ORIGIN}/?_pt=${TICKET}`);
  expect(document, JSON.stringify(seen)).toBeDefined();
  expect(document!.host).toBe(`${DOC}.${PAGES}:7999`);
  expect(document!.actor).toEqual(owner);
  // The app's own origin never receives the pages cookie.
  expect(seen.filter(entry => entry.url.startsWith(BASE)).every(entry => entry.cookie === null)).toBe(true);
}, 60_000);

it('refuses a frame that tries to leave the session origins', async () => {
  const seen: Seen[] = [];
  worker = await createSessionProcess({ credential: 'bearer', userId: 'usr_owner' }, { baseURL: BASE, pagesHost: PAGES, sandbox: { mode: 'none' },
    request: async (request, actor) => {
      seen.push({ url: request.url, host: null, cookie: null, actor });
      return new URL(request.url).pathname === '/a/doc1'
        ? new Response('<iframe data-mx-document-frame="" name="mx-document" src="http://elsewhere.test/"></iframe><iframe src="http://app.lvh.me.evil.test:7999/"></iframe>', { headers: { 'content-type': 'text/html' } })
        : new Response('never', { status: 200 });
    } });
  const out = await worker.run(`const page = await context.newPage(); await page.goto('/a/doc1'); await page.waitForTimeout(500); return page.frames().length;`);
  expect(out.error).toBeUndefined();
  expect(seen.map(entry => entry.url)).toEqual([`${BASE}/a/doc1`]);
}, 60_000);


it('delivers successive real SSE segments through the isolated worker, catches up a gap and closes subscriptions',async()=>{
 const runtime=(await build({entryPoints:[fileURLToPath(new URL('../../app/lib/http/live-stream.ts',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'LiveRuntime'})).outputFiles[0]!.text;
 const owner:Actor={credential:'bearer',userId:'usr_owner'};
 let revision=1,active=0,appActive=0,peak=0,cancelled=0;
 const seen:Array<{url:string;cursor:string|null;actor:Actor}>=[];
 const request=async(request:Request,actor:Actor)=>{
  const url=new URL(request.url);
  if(url.pathname.endsWith('/events')){
   seen.push({url:url.href,cursor:request.headers.get('last-event-id'),actor});
   if(actor!==owner)return new Response('not found',{status:404});
   return new Response(new ReadableStream({start(controller){active++;if(url.pathname.startsWith('/a/')&&!url.searchParams.has('native'))appActive++;peak=Math.max(peak,active);controller.enqueue(new TextEncoder().encode(`: connected\r\n\r\nretry: 50\r\nid: ${revision}\r\nevent: update\r\ndata: ${revision}\r\n\r\n`));},cancel(){active--;if(url.pathname.startsWith('/a/')&&!url.searchParams.has('native'))appActive--;cancelled++;}}),{headers:{'content-type':'text/event-stream'}});
  }
  return new Response(`<!doctype html><body><p id="value">0</p><script>${runtime};window.values=[];let current=0;window.live=LiveRuntime.openLiveStream({url:'/a/abc123/events',events:{update(data){const value=Number(data);if(value>current){current=value;window.values.push(value);document.querySelector('#value').textContent=String(value);}}}});window.native=new EventSource('/a/abc123/events?native=1');window.nativeValues=[];window.native.addEventListener('update',e=>window.nativeValues.push({data:e.data,id:e.lastEventId}));</script></body>`,{headers:{'content-type':'text/html'}});
 };
 worker=await createSessionProcess(owner,{baseURL:BASE,request,sandbox:{mode:'none'}});
 const first=await worker.run(`const page=await context.newPage();const failures=[];page.on('requestfailed',r=>failures.push(r.url()));page.on('pageerror',e=>failures.push(e.message));page.on('console',m=>{if(m.type()==='error')failures.push(m.text())});globalThis.testPage=page;globalThis.failures=failures;await page.goto('/a/doc1');await page.locator('#value').filter({hasText:'1'}).waitFor();return await page.evaluate(()=>window.values);`);
 expect(first.error).toBeUndefined();expect(first.result).toEqual([1]);
 // No upstream stream is open here: revision 2 happens in the transport gap.
 expect(appActive).toBe(0);revision=2;
 const second=await worker.run(`await testPage.locator('#value').filter({hasText:'2'}).waitFor();return {values:await testPage.evaluate(()=>window.values),failures};`);
 expect(second.error).toBeUndefined();expect(second.result).toEqual({values:[1,2],failures:[]});
 revision=3;
 const third=await worker.run(`await testPage.locator('#value').filter({hasText:'3'}).waitFor();await new Promise(r=>setTimeout(r,500));return {values:await testPage.evaluate(()=>window.values),failures};`);
 expect(third.error).toBeUndefined();expect(third.result).toEqual({values:[1,2,3],failures:[]});
 const native=await worker.run(`return await testPage.evaluate(()=>window.nativeValues)`);
 expect(native.error).toBeUndefined();
 expect(native.result).toEqual(expect.arrayContaining([{data:'1',id:'1'},{data:'2',id:'2'},{data:'3',id:'3'}]));
 expect(seen.some(item=>new URL(item.url).searchParams.get('since')==='1')).toBe(true);
 expect(seen.filter(item=>new URL(item.url).searchParams.has('native')).length).toBeGreaterThan(1);
 expect(peak).toBeLessThanOrEqual(2);
 for(const width of [1280,390]){
 const smoke=await worker.run(`const checkPage=await context.newPage();try{return await (${inspectPage.toString()})(checkPage,{target:'/a/doc1',viewport:{width:${width},height:800}},async page=>{await page.locator('#value').waitFor();await page.reload();await page.locator('#value').filter({hasText:'3'}).waitFor();return {reload:true};});}finally{await checkPage.close();}`);
 expect(smoke.error).toBeUndefined();
 const evidence=smoke.result as {failedRequests:unknown[];consoleErrors:string[];pageErrors:string[];httpErrors:unknown[]};
 expect(evidence.failedRequests).toEqual([]);expect(evidence.consoleErrors).toEqual([]);expect(evidence.pageErrors).toEqual([]);expect(evidence.httpErrors).toEqual([]);
 await new Promise(resolve=>setTimeout(resolve,300));expect(active).toBeLessThanOrEqual(2);
 }
 expect(peak).toBeLessThanOrEqual(6);expect(seen.length).toBeLessThan(50);
 await worker.close();worker=undefined;
 await new Promise(resolve=>setTimeout(resolve,100));expect(active).toBe(0);expect(cancelled).toBe(seen.length);
 const total=seen.length;await new Promise(resolve=>setTimeout(resolve,350));expect(seen).toHaveLength(total);
 // The same stream endpoint keeps the guest permission refusal; no owner grant enters the worker.
 const guest:Actor={credential:'none'};
 worker=await createSessionProcess(guest,{baseURL:BASE,request,sandbox:{mode:'none'}});
 const refused=await worker.run(`const page=await context.newPage();await page.goto('/');return await page.evaluate(async()=>{window.live.close();window.native.close();return (await fetch('/a/abc123/events')).status});`);
 expect(refused.error).toBeUndefined();expect(refused.result).toBe(404);expect(seen.at(-1)!.actor).toBe(guest);
},30_000);

// The author check's slide evidence: a clip is text cut off by a box its content overflows, not a tall display
// font whose glyph box pokes past a hidden-overflow box that holds all its content.
it('counts a slide clip only where a hidden-overflow box actually overflows', async () => {
 const {chromium}=await import('playwright');const browser=await chromium.launch();
 const slides=async(inner:string)=>{const page=await browser.newPage();try{return ((await inspectPage(page,{target:'data:text/html,'+encodeURIComponent(`<html><body style="margin:0"><section data-af-slide style="height:600px;padding:40px;box-sizing:border-box">${inner}</section></body></html>`),viewport:{width:1200,height:630}},null)) as {slides?:{clipped:number,items:{text:string}[]}}).slides;}finally{await page.close();}};
 try{
  expect(await slides('<div style="overflow:hidden;height:300px"><h2 style="font-size:62px;line-height:.82;margin:0"><span>Software forever.</span></h2></div>')).toMatchObject({clipped:0});
  const cut=await slides('<div style="overflow:hidden;height:60px"><p style="margin:0">One</p><p style="margin:0">Two</p><p style="margin:0">Three</p><p style="margin:0">Four hidden line</p></div>');
  expect(cut?.clipped).toBe(1);expect(cut?.items[0]).toMatchObject({text:'Four hidden line'});
 }finally{await browser.close();}
});

// A steps file that reloads keeps acting on the framed document: after the reload the document frame is a new frame.
it('runs check steps in the framed document again after page.reload()', async () => {
 let loads=0;
 const html=(body:string)=>new Response(body,{headers:{'content-type':'text/html'}});
 worker=await createSessionProcess({credential:'bearer',userId:'usr_owner'},{baseURL:BASE,pagesHost:PAGES,sandbox:{mode:'none'},request:async request=>{
  const url=new URL(request.url);
  if(url.origin===BASE&&url.pathname==='/a/doc1')return html(`<!doctype html><html><body><header>App bar</header><iframe data-mx-document-frame="" name="mx-document" src="${DOC_ORIGIN}/"></iframe></body></html>`);
  if(url.origin===DOC_ORIGIN&&url.pathname==='/'){loads++;return html(`<!doctype html><html><body><p id="status" role="status">Loading</p><script>setTimeout(()=>{document.querySelector('#status').textContent='Loaded ${loads}'},300)</script></body></html>`);}
  return new Response('not found',{status:404});
 }});
 const steps=`await page.waitForFunction(()=>document.querySelector('#status')?.textContent.startsWith('Loaded'),null,{timeout:4000});await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#status')?.textContent.startsWith('Loaded'),null,{timeout:4000});await page.getByText('Loaded 2').waitFor();return {status:await page.locator('#status').textContent()};`;
 const out=await worker.run(`const checkPage=await context.newPage();try{return await (${inspectPage.toString()})(checkPage,{target:'/a/doc1',viewport:{width:1280,height:800},hosted:true},async page=>{${steps}});}finally{await checkPage.close();}`);
 expect(out.error).toBeUndefined();
 const evidence=out.result as {error?:string;task?:unknown;steps?:unknown};
 expect(evidence.error).toBeUndefined();expect(evidence.task).toEqual({status:'Loaded 2'});expect(evidence.steps).toEqual({ran:true,passed:true});
},30_000);

// Steps reach the framed document's keyboard without a click, and a module-style steps file runs as written.
it('focuses the framed document for page.keyboard and runs an export-default steps file', async () => {
 const {stepsBody}=await import('../../app/skills/artifactbin/scripts/check.mjs');
 const html=(body:string)=>new Response(body,{headers:{'content-type':'text/html'}});
 worker=await createSessionProcess({credential:'bearer',userId:'usr_owner'},{baseURL:BASE,pagesHost:PAGES,sandbox:{mode:'none'},request:async request=>{
  const url=new URL(request.url);
  if(url.origin===BASE&&url.pathname==='/a/doc1')return html(`<!doctype html><html><body><header>App bar</header><iframe data-mx-document-frame="" name="mx-document" src="${DOC_ORIGIN}/"></iframe></body></html>`);
  if(url.origin===DOC_ORIGIN&&url.pathname==='/')return html(`<!doctype html><html><body><p id="key">none</p><script>addEventListener('keydown',e=>{document.querySelector('#key').textContent=e.key})</script></body></html>`);
  return new Response('not found',{status:404});
 }});
 const steps=stepsBody(`export default async ({page}) => {await page.locator('#key').waitFor();await page.keyboard.press('End');await page.waitForFunction(()=>document.querySelector('#key').textContent==='End',null,{timeout:3000});return {key:await page.locator('#key').textContent()};};`);
 const out=await worker.run(`const checkPage=await context.newPage();try{return await (${inspectPage.toString()})(checkPage,{target:'/a/doc1',viewport:{width:1280,height:800},hosted:true},async page=>{${steps}});}finally{await checkPage.close();}`);
 expect(out.error).toBeUndefined();
 const evidence=out.result as {error?:string;task?:unknown};
 expect(evidence.error).toBeUndefined();expect(evidence.task).toEqual({key:'End'});
},30_000);

// A step past the deadline names the numbered call still running and what the page shows, so the agent sees why it waits.
it('names the running step call and the page status when a steps file hits its deadline', async () => {
 const {chromium}=await import('playwright');const browser=await chromium.launch();const page=await browser.newPage();
 try{
  const task=new (Object.getPrototypeOf(async function(){}).constructor)('page',`await page.locator('h1').waitFor();await page.waitForFunction(()=>document.querySelector('h1').textContent==='Saved',null,{timeout:10000});`);
  const evidence=await inspectPage(page,{target:'data:text/html,'+encodeURIComponent('<html><body><h1>Budget</h1><p role="status">Could not save: offline</p></body></html>'),viewport:{width:800,height:600}},task) as {error?:string;steps?:unknown};
  // A failed run says so in steps too: a bare `steps: true` once read as a pass.
  expect(evidence.steps).toEqual({ran:true,passed:false});
  expect(evidence.error).toMatch(/^Task deadline exceeded.*\(step call #3 page\.waitForFunction\(.*; status: "Could not save: offline"; page text: "Budget Could not save: offline"/);
 }finally{await browser.close();}
},20_000);

// The author check's data-af-id evidence: duplicates in the live DOM, and script-created IDs that differ between two loads.
it('reports duplicate data-af-id values and script-created IDs that change on reload, and skips the reload when none are script-created', async () => {
 const {chromium}=await import('playwright');const browser=await chromium.launch();
 const run=async(saved:string[],body:string,compareReload=true)=>{const page=await browser.newPage();try{return await inspectPage(page,{target:'data:text/html,'+encodeURIComponent(`<html><body><script type="application/json" data-af="runtime">${JSON.stringify({savedNodeIds:saved})}</script><ul id="list" data-af-id="list">${body}</ul></body></html>`),viewport:{width:1280,height:800},compareReload},null) as unknown as {ids:{duplicates:number,items:{id:string,count:number}[]},idStability?:{checked:boolean,unstable?:number,sample?:string[]}};}finally{await page.close();}};
 try{
  const script=(ids:string)=>`<script>for(const id of ${ids}){const li=document.createElement('li');li.dataset.afId=id;li.textContent='x';document.querySelector('#list').append(li);}</script>`;
  const duplicated=await run(['list'],script("['row-1','row-1','row-2']"));
  expect(duplicated.ids.duplicates).toBe(1);expect(duplicated.ids.items[0]).toEqual({id:'row-1',count:2});expect(duplicated.idStability).toMatchObject({checked:true,unstable:0});
  const random=await run(['list'],script("['row-'+Math.random(),'row-'+Math.random()]"));
  expect(random.ids.duplicates).toBe(0);expect(random.idStability).toMatchObject({checked:true,unstable:4});expect(random.idStability!.sample!.length).toBeGreaterThan(0);
  const saved=await run(['list','a','b'],'<li data-af-id="a">A</li><li data-af-id="b">B</li>');
  expect(saved.ids.duplicates).toBe(0);expect(saved.idStability).toEqual({checked:false,created:0});
  expect((await run(['list'],script("['row-1']"),false)).idStability).toBeUndefined();
 }finally{await browser.close();}
}, 30_000);
