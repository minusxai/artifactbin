// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {applyHtmlVersion,LOADED_SOURCE,morphHtmlVersion,VersionRefused} from '../live-morph';

const SCRIPT='<script type="module" data-af-id="s1">document.querySelector(".chart").append(document.createElement("canvas"));</script>';
/** A served page: runtime JSON (revision, source IDs, script fingerprint) and the author's markup. */
function served(revision:number,body:string,{fingerprint='fp-1',head='<style data-af-id="css">h1{color:red}</style>'}:{fingerprint?:string;head?:string}={}){
 const ids=[...`<html data-af-id="h"><head data-af-id="hd">${head}</head><body data-af-id="b">${body}${SCRIPT}</body>`.matchAll(/data-af-id="([^"]+)"/g)].map(match=>match[1]);
 return `<!doctype html><html data-af-id="h"><head data-af-id="hd"><script type="application/json" data-af="runtime">${JSON.stringify({revision:String(revision),savedNodeIds:ids,scriptFingerprint:fingerprint})}</script>${head}</head><body data-af-id="b">${body}${SCRIPT}</body></html>`;
}
const V1=`<h1 data-af-id="t" class="title">Plan</h1><p data-af-id="p1">First draft.</p><p data-af-id="p2">Second.</p><div data-af-id="c" class="chart"></div><label data-af-id="l">Name <input data-af-id="i" name="n"></label>`;
/** Load `html` as the running document, as the frame would have: its source kept, a script-made chart drawn. */
function load(html:string){
 document.documentElement.innerHTML=new DOMParser().parseFromString(html,'text/html').documentElement.innerHTML;
 (window as unknown as Record<symbol,unknown>)[LOADED_SOURCE]=html;
 document.querySelector('.chart')!.append(Object.assign(document.createElement('canvas'),{id:'drawn'}));
 const input=document.querySelector('input')!;input.value='typed by the reader';input.focus();
 return {input,chart:document.querySelector('.chart')!,canvas:document.querySelector('#drawn')!,title:document.querySelector('h1')!};
}
const SCRIPTS='document.querySelector(".chart")';
afterEach(()=>{vi.restoreAllMocks();delete (window as unknown as Record<symbol,unknown>)[LOADED_SOURCE];});

describe('native HTML live morph',()=>{
 it('draws a text, markup and CSS edit in place, keeping the input, its value and focus, scroll and script-drawn nodes',()=>{
  const live=load(served(1,V1));
  const scrolled=vi.spyOn(window,'scrollTo').mockImplementation(()=>{}),reload=vi.fn();
  const v2=served(2,V1.replace('First draft.','First draft, revised.').replace('<p data-af-id="p2">Second.</p>','<p data-af-id="p2">Second.</p><p data-af-id="p3">Third, new.</p>'),{head:'<style data-af-id="css">h1{color:blue}</style>'});
  const applied=morphHtmlVersion(document,served(1,V1),v2,SCRIPTS);
  expect(applied.revision).toBe('2');expect(applied.savedNodeIds).toContain('p3');
  expect(document.querySelector('[data-af-id="p1"]')!.textContent).toBe('First draft, revised.');
  expect(document.querySelector('[data-af-id="p3"]')!.textContent).toBe('Third, new.');
  expect(document.querySelector('style[data-af-id="css"]')!.textContent).toBe('h1{color:blue}');
  // Untouched nodes are the same nodes: the reader's input keeps its value and focus, the chart keeps what its script drew.
  expect(document.querySelector('input')).toBe(live.input);expect(live.input.value).toBe('typed by the reader');expect(document.activeElement).toBe(live.input);
  expect(document.querySelector('.chart')).toBe(live.chart);expect(live.canvas.isConnected).toBe(true);expect(document.querySelector('h1')).toBe(live.title);
  expect(scrolled).not.toHaveBeenCalled();expect(reload).not.toHaveBeenCalled();
 });
 it('removes deleted source elements and swaps a changed stylesheet link only once the new one has loaded',()=>{
  const head='<link data-af-id="sheet" rel="stylesheet" href="/a/X/assets?dependency=d&amp;revision=1&amp;version=1">';
  load(served(1,V1,{head}));
  const old=document.querySelector('link[data-af-id="sheet"]')!;
  morphHtmlVersion(document,served(1,V1,{head}),served(2,V1.replace('<p data-af-id="p2">Second.</p>',''),{head:head.replace('revision=1','revision=2').replace('version=1','version=2')}),SCRIPTS);
  expect(document.querySelector('[data-af-id="p2"]')).toBeNull();
  const links=document.querySelectorAll('link[data-af-id="sheet"]');expect(links).toHaveLength(2);
  links[1]!.dispatchEvent(new Event('load'));
  expect(old.isConnected).toBe(false);expect(document.querySelectorAll('link[data-af-id="sheet"]')).toHaveLength(1);
 });
 it('treats a version-pinned asset address as unchanged',()=>{
  const img=(n:number)=>V1.replace('</h1>',`</h1><img data-af-id="img" alt="a" src="/a/X/assets?dependency=d&amp;revision=1&amp;version=${n}">`);
  load(served(1,img(1)));const before=document.querySelector('img')!.getAttribute('src');
  morphHtmlVersion(document,served(1,img(1)),served(2,img(2)),SCRIPTS);
  expect(document.querySelector('img')!.getAttribute('src')).toBe(before);
 });
 it('refuses a version whose scripts changed',()=>{
  load(served(1,V1));
  expect(()=>morphHtmlVersion(document,served(1,V1),served(2,V1.replace('Plan','Plans'),{fingerprint:'fp-2'}),SCRIPTS)).toThrow(VersionRefused);
  expect(document.querySelector('h1')!.textContent).toBe('Plan');
 });
 it('refuses edits that are not inert: interactive elements, and elements the scripts name',()=>{
  load(served(1,V1));
  expect(()=>morphHtmlVersion(document,served(1,V1),served(2,V1.replace('Name <input','Full name <input')),SCRIPTS)).toThrow(/interactive/);
  expect(()=>morphHtmlVersion(document,served(1,V1),served(2,V1.replace('<p data-af-id="p2">Second.</p>','<p data-af-id="p2">Second.</p><button data-af-id="go">Go</button>')),SCRIPTS)).toThrow(/interactive/);
  expect(()=>morphHtmlVersion(document,served(1,V1),served(2,V1.replace('<p data-af-id="p1">First draft.</p>','<p data-af-id="p1" onclick="go()">First draft.</p>')),SCRIPTS)).toThrow(/interactive/);
  // The chart container is queried by its class: changing it could break what the script wired at load.
  expect(()=>morphHtmlVersion(document,served(1,V1),served(2,V1.replace('<div data-af-id="c" class="chart"></div>','<div data-af-id="c" class="chart">Loading</div>')),SCRIPTS)).toThrow(/named in the page scripts/);
  // Unreadable script files: a changed element with an id or class cannot be cleared.
  expect(()=>morphHtmlVersion(document,served(1,V1),served(2,V1.replace('>Plan<','>Plans<')),null)).toThrow(/could not be read/);
  // A plain paragraph without id or class is still inert.
  expect(()=>morphHtmlVersion(document,served(1,V1),served(2,V1.replace('First draft.','Edited.')),null)).not.toThrow();
 });
});

describe('applyHtmlVersion (inside the frame)',()=>{
 it('fetches its own address without the ticket, draws the version and keeps it as the next baseline',async()=>{
  load(served(1,V1));
  const next=served(2,V1.replace('Second.','Second, edited.'));
  const fetchFn=vi.fn(async(url:string)=>url.includes('/af/v1/')||url.endsWith('.js')?new Response(''):new Response(next));
  const applied=await applyHtmlVersion(window,{revision:'1'},2,fetchFn as unknown as typeof fetch);
  expect(applied.revision).toBe('2');expect(String(fetchFn.mock.calls[0]![0])).not.toContain('_pt=');
  expect(document.querySelector('[data-af-id="p2"]')!.textContent).toBe('Second, edited.');
  expect((window as unknown as Record<symbol,unknown>)[LOADED_SOURCE]).toBe(next);
 });
 it('rejects (so the parent reloads) when the document kept no source, the fetch fails, the version is older, or the morph throws',async()=>{
  const ok=async()=>new Response(served(2,V1.replace('Second.','Edited.')));
  await expect(applyHtmlVersion(window,{revision:'1'},2,ok as unknown as typeof fetch)).rejects.toThrow(VersionRefused);
  load(served(1,V1));
  await expect(applyHtmlVersion(window,{revision:'1'},2,(async()=>new Response('',{status:500})) as unknown as typeof fetch)).rejects.toThrow(VersionRefused);
  await expect(applyHtmlVersion(window,{revision:'1'},3,ok as unknown as typeof fetch)).rejects.toThrow(/not the published one/);
  vi.spyOn(Element.prototype,'replaceChildren');vi.spyOn(Node.prototype,'insertBefore').mockImplementation(()=>{throw Error('DOM refused');});
  await expect(applyHtmlVersion(window,{revision:'1'},2,(async()=>new Response(served(2,V1.replace('</h1>','</h1><p data-af-id="n">New</p>')))) as unknown as typeof fetch)).rejects.toThrow('DOM refused');
 });
});
