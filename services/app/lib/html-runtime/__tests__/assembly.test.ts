import { expect, it } from 'vitest';
import { assembleHtmlPage } from '../index';
it('boots core before authored scripts and preserves native HTML', () => {
  const result = assembleHtmlPage({ html: '<!doctype html><html><head><script>author()</script></head><body><x-chart data-af-id="n1">Hello</x-chart></body></html>', core: 'core()', config: { pageId: 'a', revision: 'r', backends: [] } });
  expect(result.indexOf('core()')).toBeLessThan(result.indexOf('author()'));
  expect(result).toContain('<x-chart data-af-id="n1">Hello</x-chart>');
  expect(result).not.toContain('mx-story-data');
});
it('escapes configuration script delimiters and makes downloads explicitly offline', () => {
  const result = assembleHtmlPage({ html: '<html><body></body></html>', core: 'core()', config: { pageId: 'a', revision: '</script>', backends: ['orders'], appOrigin: 'https://platform.example' }, offline: true });
  expect(result).toContain('\\u003c/script>');
  expect(result).toContain('"offline":true');
  expect(result).not.toContain('https://platform.example');
});
it('captures authored initial state before the first head script executes', () => {
  const result = assembleHtmlPage({ html: '<html><body><script type="application/json" data-af="state">{"count":3}</script></body></html>', core: 'core()', config: { pageId: 'a', revision: 'r', backends: [] } });
  expect(result).toContain('"initialState":{"count":3}');
});

it('replaces the canonical core loader while retaining its stable node identity', () => {
  const result = assembleHtmlPage({ html: '<html><head><script src="/af/core.js" data-af-id="n1"></script></head><body></body></html>', core: 'core()', config: { pageId: 'a', revision: '1', backends: [] }, offline: true });
  expect(result).not.toContain('src="/af/core.js"');
  expect(result).toContain('data-af="core" data-af-id="n1"');
  expect(result.match(/core\(\)/g)).toHaveLength(1);
});
it('round-trips HTML and line-separator characters in viewer state without executable delimiters', () => {
  const initialState = { label: '<tag></script>', line: String.fromCharCode(0x2028, 0x2029) };
  const result = assembleHtmlPage({ html: '<html><body></body></html>', core: 'core()', config: { pageId: 'a', revision: '1', backends: [], initialState } });
  const config = /<script type="application\/json" data-af="runtime">([\s\S]*?)<\/script>/.exec(result)![1]!;
  expect(config).not.toContain('</script>');
  expect(JSON.parse(config).initialState).toEqual(initialState);
});
it('provides source identities independently of runtime-created DOM or caller configuration',()=>{
 const output=assembleHtmlPage({html:'<!doctype html><html><body><ul data-af-id="tasks"></ul><script>document.querySelector("ul").innerHTML="dynamic"</script></body></html>',core:'core()',config:{pageId:'p',revision:'1',backends:[],savedNodeIds:['forged']}});
 const match=output.match(/<script type="application\/json" data-af="runtime">([^<]*)<\/script>/);
 expect(JSON.parse(match![1]!).savedNodeIds).toEqual(['tasks']);
});
const pinned={apollo:`/af/v1/runtime/${'a'.repeat(64)}/apollo.js`,reader:`/af/v1/runtime/${'b'.repeat(64)}/reader.js`,state:`/af/v1/runtime/${'c'.repeat(64)}/state.js`,morph:`/af/v1/runtime/${'d'.repeat(64)}/morph.js`};
const preloads=(html:string)=>[...html.matchAll(/<link [^>]*rel="modulepreload"[^>]*>/g)].map(match=>match[0]);
it('preloads apollo, reader and state at the addresses the runtime config names, after the core installs its import map',()=>{
 for(const script of ['import {sql} from "@afbin/apollo";','const {sql}=await import(\'@afbin/apollo\');']){
  const html=assembleHtmlPage({html:`<!doctype html><html><head><link rel="stylesheet" href="./mine.css"><script type="module">${script}</script></head><body></body></html>`,core:'core()',config:{pageId:'p',revision:'1',backends:[],appearance:{designSystem:'redline',mode:'light'},modules:pinned},systemsHref:'/af/styles.css'});
  const links=preloads(html);
  expect(links).toEqual([pinned.apollo,pinned.reader,pinned.state].map(href=>`<link rel="modulepreload" href="${href}" crossorigin="">`));
  const config=JSON.parse(/data-af="runtime">([^<]*)<\/script>/.exec(html)![1]!);
  expect(config.modules).toEqual(pinned);
  // The core is a classic inline script that installs the import map synchronously: a link the parser reaches after it cannot start a fetch first.
  const core=html.indexOf('core()'),first=html.indexOf(links[0]!);
  expect(core).toBeGreaterThan(-1);expect(first).toBeGreaterThan(core);
  expect(html.indexOf('data-af="platform-styles"')).toBeLessThan(first);
  expect(first).toBeLessThan(html.indexOf('mine.css'));
 }
});
it('preloads nothing for a page that does not import apollo, an export, or a page with no pinned modules',()=>{
 const page='<html><head><script type="module">import "@afbin/state";</script></head><body></body></html>';
 expect(preloads(assembleHtmlPage({html:page,core:'core()',config:{pageId:'p',revision:'1',backends:[],modules:pinned}}))).toEqual([]);
 const apollo='<html><head><script type="module">import {sql} from "@afbin/apollo";</script></head><body></body></html>';
 expect(preloads(assembleHtmlPage({html:apollo,core:'core()',config:{pageId:'p',revision:'1',backends:[]}}))).toEqual([]);
 const exported=assembleHtmlPage({html:apollo,core:'core()',config:{pageId:'p',revision:'1',backends:[],modules:pinned},offline:true});
 expect(preloads(exported)).toEqual([]);
 expect(JSON.parse(/data-af="runtime">([^<]*)<\/script>/.exec(exported)![1]!).modules).toBeUndefined();
});
