// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {applyHtmlVersion,interactive,LOADED_SOURCE,morphHtmlVersion,VersionRefused} from '../live-morph';
import {MARKDOWN_ROOT} from '@/lib/html-components/markdown-styles';

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
afterEach(()=>{vi.restoreAllMocks();sessionStorage.clear();delete (window as unknown as Record<symbol,unknown>)[LOADED_SOURCE];});

describe('native HTML live morph',()=>{
 it('keeps the platform-owned <html> attributes the core set, and follows a new design-system meta (D4)',()=>{
  const legacy=served(1,V1).replace('<html data-af-id="h">','<html data-af-id="h" data-af-dark="false" data-af-design-system="riso">');
  load(legacy);
  document.documentElement.setAttribute('data-af-dark','true');document.documentElement.setAttribute('data-af-design-system','riso');
  const v2=served(2,V1).replace('"scriptFingerprint"','"appearance":{"designSystem":"volta","mode":"light"},"scriptFingerprint"');
  morphHtmlVersion(document,legacy,v2,SCRIPTS);
  expect(document.documentElement.getAttribute('data-af-dark')).toBe('true');
  expect(document.documentElement.getAttribute('data-af-design-system')).toBe('volta');
 });
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
  expect(()=>morphHtmlVersion(document,served(1,V1),served(2,V1.replace('<input data-af-id="i" name="n">','')),SCRIPTS)).toThrow(/interactive/);
  // The chart container is queried by its class: changing it could break what the script wired at load.
  expect(()=>morphHtmlVersion(document,served(1,V1),served(2,V1.replace('<div data-af-id="c" class="chart"></div>','<div data-af-id="c" class="chart">Loading</div>')),SCRIPTS)).toThrow(/named in the page scripts/);
  // Unreadable script files: a changed element with an id or class cannot be cleared.
  expect(()=>morphHtmlVersion(document,served(1,V1),served(2,V1.replace('>Plan<','>Plans<')),null)).toThrow(/could not be read/);
  // A plain paragraph without id or class is still inert.
  expect(()=>morphHtmlVersion(document,served(1,V1),served(2,V1.replace('First draft.','Edited.')),null)).not.toThrow();
 });
});

describe('editable regions (data-af-editable)',()=>{
 const REGION=(inner:string,attrs='')=>V1.replace('<p data-af-id="p2">Second.</p>',`<article data-af-id="r1" data-af-editable="rich"${attrs}>${inner}</article>`);
 const SAVED='<p data-af-id="a1">Saved <strong>text</strong>.</p><ul data-af-id="l1"><li data-af-id="i1"><p data-af-id="a2">Item</p></li></ul>';
 it('a reader frame (no editor) draws a saved region version in place: its text, links and new blocks are content, not controls',()=>{
  const live=load(served(1,REGION(SAVED)));const region=document.querySelector('article')!;
  const next=served(2,REGION('<p data-af-id="a1">Saved <a href="https://example.com/x">link</a> now.</p><ul data-af-id="l1"><li data-af-id="i1"><p data-af-id="a2">Item, edited</p></li><li data-af-id="i2"><p data-af-id="a3">Another</p></li></ul><blockquote data-af-id="q1"><p data-af-id="a4">Quoted</p></blockquote>'));
  morphHtmlVersion(document,served(1,REGION(SAVED)),next,SCRIPTS);
  expect(document.querySelector('article')).toBe(region);
  expect(region.innerHTML).toBe('<p data-af-id="a1">Saved <a href="https://example.com/x">link</a> now.</p><ul data-af-id="l1"><li data-af-id="i1"><p data-af-id="a2">Item, edited</p></li><li data-af-id="i2"><p data-af-id="a3">Another</p></li></ul><blockquote data-af-id="q1"><p data-af-id="a4">Quoted</p></blockquote>');
  expect(document.activeElement).toBe(live.input);
 });
 it('still refuses what a region cannot hold, an interactive region element, and interactive edits outside it',()=>{
  load(served(1,REGION(SAVED)));
  expect(()=>morphHtmlVersion(document,served(1,REGION(SAVED)),served(2,REGION(SAVED.replace('Item','Item <button data-af-id="go">Go</button>'))),SCRIPTS)).toThrow(/interactive/);
  expect(()=>morphHtmlVersion(document,served(1,REGION(SAVED)),served(2,REGION(SAVED.replace('<p data-af-id="a1">','<p data-af-id="a1" onclick="go()">'))),SCRIPTS)).toThrow(/interactive/);
  expect(()=>morphHtmlVersion(document,served(1,REGION(SAVED)),served(2,REGION(SAVED.replace('Saved','Saved <a href="/x" target="_top">x</a>'))),SCRIPTS)).toThrow(/interactive/);
  const unknownKind=(inner:string)=>REGION(inner).replace('data-af-editable="rich"','data-af-editable="spreadsheet"');
  load(served(1,unknownKind(SAVED)));
  expect(()=>morphHtmlVersion(document,served(1,unknownKind(SAVED)),served(2,unknownKind(SAVED.replace('Item','Item, edited'))),SCRIPTS)).toThrow(/interactive/);
  load(served(1,REGION(SAVED)));
  expect(()=>morphHtmlVersion(document,served(1,REGION(SAVED)),served(2,REGION(SAVED.replace('Item','Item, edited')).replace('Name <input','Full name <input')),SCRIPTS)).toThrow(/interactive/);
 });
 it('while an editor holds the region, a version leaves its element to the editor (no refusal, no redraw) and draws the rest',()=>{
  load(served(1,REGION(SAVED)));
  const region=document.querySelector('article')!;
  // What an editor shows: its own DOM on the region's element.
  region.setAttribute('contenteditable','true');region.innerHTML='<p data-af-id="a1">Live, unsaved typing</p>';const editing=region.firstChild!;
  const next=served(2,REGION('<p data-af-id="a1">Saved by flush</p><p data-af-id="a9">New</p>',' class="moved"').replace('First draft.','First draft, revised.'));
  const applied=morphHtmlVersion(document,served(1,REGION(SAVED)),next,SCRIPTS,undefined,new Map([['r1',region]]));
  expect(applied.revision).toBe('2');expect(applied.savedNodeIds).toContain('a9');
  expect(document.querySelector('article')).toBe(region);expect(region.firstChild).toBe(editing);
  expect(region.innerHTML).toBe('<p data-af-id="a1">Live, unsaved typing</p>');expect(region.hasAttribute('class')).toBe(false);
  expect(document.querySelector('[data-af-id="p1"]')!.textContent).toBe('First draft, revised.');
  expect(document.querySelector('[data-mx-edit-region]')).toBeNull();
  // A region nobody edits is still drawn; an interactive edit outside the held region still refuses.
  expect(()=>morphHtmlVersion(document,served(2,REGION(SAVED)),served(3,REGION(SAVED).replace('Name <input','Full name <input')),SCRIPTS,undefined,new Map([['r1',region]]))).toThrow(/interactive/);
 });
});

describe('applyHtmlVersion (inside the frame)',()=>{
 it('follows live text within a version: the served page must be at least as live as announced; provisional ids are drawn, not offered',async()=>{
  const regionPage=(body:string)=>V1.replace('<p data-af-id="p2">Second.</p>',`<article data-af-id="r1" data-af-editable="rich">${body}</article>`);
  load(served(1,regionPage('<p data-af-id="a1">Hello</p>')));
  // The current page at version 1, live 5: a typed block with a provisional id (not one of the saved node ids).
  const live=(n:number,body:string,revision=1)=>served(revision,regionPage(body)).replace('"scriptFingerprint"',`"live":${n},"scriptFingerprint"`).replace('"af-9",','');
  const next=live(5,'<p data-af-id="a1">Hello there</p><p data-af-id="af-9">Typed live.</p>');
  const fetchFn=vi.fn(async(url:string)=>url.endsWith('.js')?new Response(''):new Response(next));
  const applied=await applyHtmlVersion(window,{revision:'1'},1,fetchFn as unknown as typeof fetch,undefined,5);
  expect(applied).toMatchObject({revision:'1',live:5});expect(applied.rebuild).toBeUndefined();
  expect(document.querySelector('article')!.textContent).toBe('Hello thereTyped live.');
  expect(applied.savedNodeIds).toContain('a1');expect(applied.savedNodeIds).not.toContain('af-9');
  // Older live text than announced is not the current page (the parent reloads); a newer version always is.
  const older=async()=>new Response(live(3,'<p data-af-id="a1">Hello</p>'));
  await expect(applyHtmlVersion(window,{revision:'1',live:2},1,older as unknown as typeof fetch,undefined,4)).rejects.toThrow(/older than its announced live text/);
  // Live text the document already holds is not fetched again (a page's first ping names the live text it was served).
  const none=vi.fn(async()=>new Response('unused'));
  await expect(applyHtmlVersion(window,{revision:'1',live:5,savedNodeIds:['a1']},1,none as unknown as typeof fetch,undefined,5)).resolves.toEqual({revision:'1',live:5,savedNodeIds:['a1']});
  expect(none).not.toHaveBeenCalled();
  const newer=vi.fn(async(url:string)=>url.endsWith('.js')?new Response(''):new Response(live(0,'<p data-af-id="a1">Saved.</p>',2)));
  await expect(applyHtmlVersion(window,{revision:'1',live:5},1,newer as unknown as typeof fetch,undefined,9)).resolves.toMatchObject({revision:'2',live:0});
 });
 it('fetches its own address without the ticket, draws the version and keeps it as the next baseline',async()=>{
  load(served(1,V1));
  const next=served(2,V1.replace('Second.','Second, edited.'));
  const fetchFn=vi.fn(async(url:string)=>url.includes('/af/v1/')||url.endsWith('.js')?new Response(''):new Response(next));
  const applied=await applyHtmlVersion(window,{revision:'1'},2,fetchFn as unknown as typeof fetch);
  expect(applied.revision).toBe('2');expect(String(fetchFn.mock.calls[0]![0])).not.toContain('_pt=');expect((fetchFn.mock.calls[0] as unknown as [string,RequestInit])[1].headers).toEqual({'x-artifactbin-live-version':'1'});
  expect(document.querySelector('[data-af-id="p2"]')!.textContent).toBe('Second, edited.');
  expect((window as unknown as Record<symbol,unknown>)[LOADED_SOURCE]).toBe(next);
 });
 it('rejects (so the parent reloads) only when no valid new version was read: no kept source, a failed fetch, an older version',async()=>{
  const ok=async()=>new Response(served(2,V1.replace('Second.','Edited.')));
  await expect(applyHtmlVersion(window,{revision:'1'},2,ok as unknown as typeof fetch)).rejects.toThrow(VersionRefused);
  load(served(1,V1));
  await expect(applyHtmlVersion(window,{revision:'1'},2,(async()=>new Response('',{status:500})) as unknown as typeof fetch)).rejects.toThrow(VersionRefused);
  await expect(applyHtmlVersion(window,{revision:'1'},3,ok as unknown as typeof fetch)).rejects.toThrow(/not the published one/);
  expect(sessionStorage.length).toBe(0);
 });
 it('asks for a rebuild, keeping the reader\'s place, when the scripts changed, the edit is not inert, or the morph throws',async()=>{
  for(const [next,broken,reason] of [
   [served(2,V1.replace('Plan','Plans'),{fingerprint:'fp-2'}),false,'the new version runs different scripts'],
   [served(2,V1.replace('Name <input','Full name <input')),false,'an interactive element changed'],
   [served(2,V1.replace('</h1>','</h1><p data-af-id="n">New</p>')),true,'DOM refused'],
  ] as const){
   const html=served(1,V1);load(html);sessionStorage.clear();
   history.replaceState(null,'','/?_pt=ticket&%24tab=2#af-state=abc');
   if(broken)vi.spyOn(Node.prototype,'insertBefore').mockImplementationOnce(()=>{throw Error('DOM refused');});
   const fetchFn=vi.fn(async(url:string)=>url.endsWith('.js')?new Response(''):new Response(next));
   const applied=await applyHtmlVersion(window,{revision:'1',pageId:'page-1'},2,fetchFn as unknown as typeof fetch);
   // Its own address, without the spent ticket or a state fragment that would replace the viewer's own state.
   expect(applied).toMatchObject({revision:'2',savedNodeIds:[],rebuild:new URL('/?%24tab=2',location.href).href});
   // Why, for the parent to report (solid/document/follow-html-version).
   expect(applied.reason).toContain(reason);
   expect(JSON.parse(sessionStorage.getItem('afbin:reading-place:page-1')!)).toMatchObject({focus:'i'});
   // The running document is not the new version's baseline: the rebuilt one loads its own.
   expect((window as unknown as Record<symbol,unknown>)[LOADED_SOURCE]).toBe(html);
   vi.restoreAllMocks();
  }
  history.replaceState(null,'','/');
 });
});

it('keeps a doc region that carries the Markdown root morphable: a styling hook is not an interactive element',()=>{
 // A doc's article is the rich region AND the Markdown stylesheet's root (lib/workspace artifact-starters); readers
 // follow its typing by morphing, so marking it for the stylesheet must not make it platform behaviour.
 const marker=MARKDOWN_ROOT.startsWith('.')?`class="${MARKDOWN_ROOT.slice(1)}"`:MARKDOWN_ROOT.slice(1,-1);
 const article=new DOMParser().parseFromString(`<article data-af-editable="rich" ${marker} data-af-id="a"><h1 data-af-id="t">Title</h1></article>`,'text/html').querySelector('article')!;
 expect(article.matches(MARKDOWN_ROOT)).toBe(true);
 expect(interactive(article)).toBe(false);
});
