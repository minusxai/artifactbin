/**
 * html-runtime's remaining doors: local state in a URL, what local state may hold, the live version wire names,
 * the portable file's recovery and digest, and the browser download of a portable copy.
 */
import {afterEach,describe,expect,it,vi} from 'vitest';
import {HTML_VERSION_APPLIED,HTML_VERSION_MESSAGE,HTML_VERSION_REFUSED,LIVE_VERSION_HEADER} from '../live-morph-contract';
import {LIVE_VERSION_HEADER as INDEX_LIVE_VERSION_HEADER,assertStorable,decodeState,downloadableHtml,encodeState,readStateFragment,stateUrl} from '../index';
import {hasPortableDocument,readPortableDocument} from '../portable';
import {portableRenderedDigest,recoverPortableRendering} from '../portable-source';
import {PORTABLE_CHROME_HEIGHT} from '../portable-chrome-contract';
import {downloadPortableCopy} from '../browser-portable';

describe('local state in a URL',()=>{
 it('round-trips unicode state through an unpadded base64url fragment',()=>{
  const state={title:'Café ☕ 名前',n:[1,2.5,-3],nested:{ok:true,none:null}};
  const encoded=encodeState(state);
  expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(decodeState(encoded)).toEqual(state);
  expect(decodeState(encoded+'==')).toEqual(state);
  expect(decodeState(encodeState({}))).toEqual({});
 });

 it('refuses non-objects, unstorable values and state past the 256 KB limit, both ways',()=>{
  for(const value of [null,[],'x',1])expect(()=>encodeState(value as never)).toThrow('Local state must be an object');
  expect(()=>encodeState({when:new Date(0)} as never)).toThrow('a Date');
  expect(()=>encodeState({big:'x'.repeat(256*1024)})).toThrow('State too large');
  expect(()=>decodeState('A'.repeat(Math.ceil(256*1024*4/3)+1))).toThrow('State too large');
  expect(()=>decodeState('')).toThrow('af-state is empty');
  expect(()=>decodeState('a+b/')).toThrow('not base64url');
  expect(()=>decodeState('A')).toThrow('not base64url');
  expect(()=>decodeState(encodeState({a:1}).slice(0,-3))).toThrow('not JSON');
  expect(()=>decodeState(Buffer.from('[1]').toString('base64url'))).toThrow('must hold a JSON object');
 });

 it('writes the fragment on the page address, replacing any earlier fragment',()=>{
  const url=stateUrl('https://p.test/a/x?y=1#old',{tab:2});
  expect(url).toBe(`https://p.test/a/x?y=1#af-state=${encodeState({tab:2})}`);
  expect(readStateFragment(new URL(url).hash)).toEqual({found:true,state:{tab:2},error:null,rest:''});
 });

 it('reads the state beside other fragment parts, and reports a broken one without throwing',()=>{
  const encoded=encodeState({a:'é'});
  expect(readStateFragment(`#top&af-state=${encoded}&x=1`)).toEqual({found:true,state:{a:'é'},error:null,rest:'#top&x=1'});
  expect(readStateFragment('#top')).toEqual({found:false,state:null,error:null,rest:'#top'});
  expect(readStateFragment('')).toEqual({found:false,state:null,error:null,rest:''});
  expect(readStateFragment(undefined as never)).toEqual({found:false,state:null,error:null,rest:''});
  expect(readStateFragment('#af-state=***')).toEqual({found:true,state:null,error:'af-state is not base64url',rest:''});
 });
});

describe('what local state may hold',()=>{
 it('admits JSON values: strings, finite numbers, booleans, null, dense arrays and plain or null-prototype objects',()=>{
  const bare=Object.assign(Object.create(null) as object,{a:[1,'b',null,{c:false}]});
  for(const value of [null,'',0,true,[],{},bare,{'ünï':'☕'}])expect(()=>assertStorable(value)).not.toThrow();
 });

 it('names what it refuses and where',()=>{
  const cycle:Record<string,unknown>={};cycle.self=cycle;
  const sparse=[1,,3];
  const accessor=Object.defineProperty({},'x',{get:()=>1,enumerable:true});
  class Point{x=1;}
  const cases:Array<[unknown,string]>=[
   [undefined,'Cannot store undefined at value'],[NaN,'Cannot store NaN at value'],[{a:{b:Infinity}},'Cannot store Infinity at value.a.b'],
   [{f:()=>1},'Cannot store a function at value.f'],[[new Date(0)],'a Date (store dates as ISO strings) at value[0]'],
   [cycle,'circular reference at value.self'],[sparse,'sparse or extended array at value'],[{[Symbol('s')]:1},'symbol keys at value'],
   [accessor,'an accessor at value.x'],[new Point(),'an instance of Point at value'],[new Map(),'an instance of Map at value'],[1n,'Cannot store bigint at value'],
  ];
  for(const [value,message] of cases)expect(()=>assertStorable(value)).toThrow(message);
 });

 it('admits the same object twice when it is shared rather than circular',()=>{
  const shared={x:1};
  expect(()=>assertStorable({a:shared,b:[shared,shared]})).not.toThrow();
 });
});

describe('live version wire names',()=>{
 it('are distinct, namespaced messages and one lowercase header name the index re-exports',()=>{
  expect(new Set([HTML_VERSION_MESSAGE,HTML_VERSION_APPLIED,HTML_VERSION_REFUSED]).size).toBe(3);
  for(const name of [HTML_VERSION_MESSAGE,HTML_VERSION_APPLIED,HTML_VERSION_REFUSED])expect(name).toMatch(/^mx:version/);
  expect(INDEX_LIVE_VERSION_HEADER).toBe(LIVE_VERSION_HEADER);
  expect(LIVE_VERSION_HEADER).toBe(LIVE_VERSION_HEADER.toLowerCase());
  expect(new Headers({[LIVE_VERSION_HEADER]:'3'}).get(LIVE_VERSION_HEADER)).toBe('3');
 });
});

describe('portable files',()=>{
 const source='<!doctype html><html><head><title>Café</title><script src="/af/core.js" data-af-id="c1"></script></head><body><h1 data-af-id="h">名前 ☕</h1></body></html>';
 const portable=()=>downloadableHtml({html:source,core:'/*c*/',apollo:'export {};',reader:'export {};',platformScriptNonce:'test-nonce-1234567890',portable:{version:1,source},config:{pageId:'p',revision:'1',backends:[]}});

 it('finds the canonical block only in a downloaded copy',()=>{
  expect(hasPortableDocument(portable())).toBe(true);
  for(const html of [source,'','<script type="application/json" data-af="other">{}</script>'])expect(hasPortableDocument(html)).toBe(false);
 });

 it('recovers the author rendering from a downloaded file: generated blocks out, the core back at its address',()=>{
  const file=portable();
  const recovered=recoverPortableRendering(file);
  expect(recovered).not.toContain('data-af="portable"');
  expect(recovered).toContain('<script src="/af/core.js" data-af-id="c1"></script>');
  expect(recovered).toContain('<h1 data-af-id="h">名前 ☕</h1>');
  expect(portableRenderedDigest(recovered)).toBe(readPortableDocument(file).renderedDigest);
  // Not a portable file: the bytes come back untouched.
  expect(recoverPortableRendering(source)).toBe(source);
 });

 it('digests the parsed page ignoring only the replaceable core loader',()=>{
  const digest=portableRenderedDigest(source);
  expect(digest).toMatch(/^[0-9a-f]{64}$/);
  expect(portableRenderedDigest(source.replace('/af/core.js','/af/v1/core.js'))).toBe(digest);
  expect(portableRenderedDigest(source.replace('<script src="/af/core.js" data-af-id="c1"></script>',''))).toBe(digest);
  expect(portableRenderedDigest(source.replace('☕','🍵'))).not.toBe(digest);
  expect(portableRenderedDigest(source.replace('<script src="/af/core.js"','<script src="/other.js"'))).not.toBe(digest);
 });

 it('reserves a fixed chrome band above the local copy',()=>{
  expect(PORTABLE_CHROME_HEIGHT).toBe(76);
 });
});

describe('downloading a portable copy',()=>{
 afterEach(()=>{vi.restoreAllMocks();});
 it('clicks one download link for an html blob and revokes its object URL afterwards',async()=>{
  const link={href:'',download:'',click:vi.fn()};
  const timers:Array<()=>void>=[];
  const win={document:{createElement:vi.fn(()=>link)},setTimeout:(fn:()=>void,ms:number)=>{expect(ms).toBe(1000);timers.push(fn);}} as unknown as Window;
  const created=vi.spyOn(URL,'createObjectURL');
  const revoked=vi.spyOn(URL,'revokeObjectURL');
  downloadPortableCopy(win,'<p>☕</p>','report.html');
  expect(link.click).toHaveBeenCalledTimes(1);
  expect(link.download).toBe('report.html');
  const blob=created.mock.calls[0]![0] as Blob;
  expect(blob.type).toBe('text/html;charset=utf-8');
  expect(await blob.text()).toBe('<p>☕</p>');
  expect(revoked).not.toHaveBeenCalled();
  timers.forEach(fn=>fn());
  expect(revoked).toHaveBeenCalledWith(link.href);
  downloadPortableCopy(win,'');
  expect(link.download).toBe('page.html');
 });
});
