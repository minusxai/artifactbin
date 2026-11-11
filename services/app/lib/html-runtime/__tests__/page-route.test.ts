/**
 * `seat()` and `route` (../page-route, exported by `@afbin/state`): where a page runs and which screen it shows,
 * against real history and message events in each place a page is served.
 */
import {describe,expect,it,vi} from 'vitest';
import {createPageRoute,pageSeat,routeSearch,routeValuesOf} from '../page-route';

const APP='https://app.test';

/** A page's window: its own history and listeners, framed by `parent` or not. */
function pageWindow(href:string,{framed=false,origin=new URL(href).origin}={}){
 let url=new URL(href);const entries=[url.href];let at=0;
 const listeners=new Map<string,Set<(event:any)=>void>>();
 const parent={postMessage:vi.fn()};
 const history={state:null,
  pushState(_s:unknown,_t:string,next:string){url=new URL(next,url);entries.splice(at+1,Infinity,url.href);at++;},
  replaceState(_s:unknown,_t:string,next:string){url=new URL(next,url);entries[at]=url.href;},
 };
 const win:any={origin,history,
  get location(){return {href:url.href,pathname:url.pathname,search:url.search,hash:url.hash,origin:url.origin};},
  addEventListener(type:string,listener:(event:any)=>void){(listeners.get(type)??listeners.set(type,new Set()).get(type)!).add(listener);},
  removeEventListener(type:string,listener:(event:any)=>void){listeners.get(type)?.delete(listener);},
 };
 win.parent=framed?parent:win;
 const fire=(type:string,event:any={})=>{for(const listener of listeners.get(type)??[])listener(event);};
 return {win,parent,entries,fire,back(){at--;url=new URL(entries[at]!);fire('popstate');},url:()=>url.href};
}

describe('seat()',()=>{
 it('names each place a page runs and what its doors can do there',()=>{
  const online=()=>false;
  expect(pageSeat(pageWindow('https://abc.pages.test/',{framed:true}).win,{pageId:'p1',appOrigin:APP,online})).toEqual({kind:'app',pageId:'p1',sql:true,writes:true});
  expect(pageSeat(pageWindow('https://abc.pages.test/').win,{pageId:'p1',appOrigin:APP,online})).toEqual({kind:'address',pageId:'p1',sql:false,writes:false});
  expect(pageSeat(pageWindow('https://me.u.test/report').win,{pageId:'p1',appOrigin:APP,domainReads:true,online})).toEqual({kind:'address',pageId:'p1',sql:true,writes:false});
  expect(pageSeat(pageWindow('https://app.test/a/p1/raw',{origin:'null'}).win,{pageId:'p1',appOrigin:APP,online})).toEqual({kind:'raw',pageId:'p1',sql:false,writes:false});
  expect(pageSeat(pageWindow('file:///tmp/copy.html',{origin:'null'}).win,{pageId:'p1',offline:true,online})).toEqual({kind:'offline',pageId:'p1',sql:true,writes:false});
  expect(pageSeat(pageWindow('http://127.0.0.1:4000/').win,{pageId:'local:/',offline:true,localPreview:{},online:()=>true})).toMatchObject({kind:'preview',sql:true,writes:false});
 });
});

describe('route values in the address',()=>{
 it('reads and writes only `$` pairs, refusing names that are not names and an address past the app\'s bound',()=>{
  expect(routeValuesOf('?_pt=x&$screen=detail&%24id=4%202&$bad-name=1&$e=%E2&mx-mode=dark')).toEqual({screen:'detail',id:'4 2'});
  expect(routeSearch({screen:'detail',id:42,gone:null,empty:''})).toBe('?$screen=detail&$id=42');
  expect(routeSearch({})).toBe('');
  expect(()=>routeSearch({'a-b':1})).toThrow(TypeError);
  expect(()=>routeSearch({big:'x'.repeat(9000)})).toThrow('too long');
 });
});

describe('route at a page\'s own address',()=>{
 it('replaces or pushes its own history, hears Back, and links to itself without other params',()=>{
  const page=pageWindow('https://abc.pages.test/?mx-mode=dark&$screen=home#notes');
  const route=createPageRoute(page.win,{pageId:'p1',appOrigin:APP});
  const seen=vi.fn();route.subscribe(seen);
  expect(route.get()).toEqual({screen:'home'});
  route.set({screen:'detail',id:'7'},{push:true});
  expect(page.url()).toBe('https://abc.pages.test/?mx-mode=dark&$screen=detail&$id=7#notes');
  expect(page.entries).toHaveLength(2);
  expect(seen).toHaveBeenLastCalledWith({screen:'detail',id:'7'});
  route.set({screen:'detail',id:'8'});
  expect(page.entries).toHaveLength(2);
  page.back();
  expect(route.get()).toEqual({screen:'home'});
  expect(seen).toHaveBeenLastCalledWith({screen:'home'});
  expect(seen).toHaveBeenCalledTimes(3);
  expect(route.href({screen:'detail',id:'9'})).toBe('https://abc.pages.test/?$screen=detail&$id=9');
  expect(page.parent.postMessage).not.toHaveBeenCalled();
 });

 it('keeps the values for this visit where the address cannot be rewritten',()=>{
  const page=pageWindow('file:///tmp/copy.html',{origin:'null'});
  page.win.history.pushState=page.win.history.replaceState=()=>{throw new DOMException('refused','SecurityError');};
  const route=createPageRoute(page.win,{pageId:'p1',offline:true});
  route.set({screen:'detail'},{push:true});
  expect(route.get()).toEqual({screen:'detail'});
 });
});

describe('route in the app\'s frame',()=>{
 it('moves its own address in place, hands the app the values (and the push), and follows the app\'s Back and Forward',()=>{
  const page=pageWindow('https://abc.pages.test/?_pt=spent&$screen=home',{framed:true});
  const route=createPageRoute(page.win,{pageId:'p1',appOrigin:APP});
  const seen=vi.fn();route.subscribe(seen);
  route.set({screen:'detail',id:'7'},{push:true});
  expect(page.entries,'the frame adds no history of its own').toHaveLength(1);
  expect(page.url()).toBe('https://abc.pages.test/?_pt=spent&$screen=detail&$id=7');
  expect(page.parent.postMessage).toHaveBeenLastCalledWith({type:'mx:url-values',search:'?$screen=detail&$id=7',push:true},APP);
  route.set({screen:'list'});
  expect(page.parent.postMessage).toHaveBeenLastCalledWith({type:'mx:url-values',search:'?$screen=list'},APP);
  // The reader pressed Back in the app: its address holds the values again, and tells the frame.
  page.fire('message',{source:page.parent,origin:APP,data:{type:'mx:url-values',search:'?$screen=detail&$id=7'}});
  expect(route.get()).toEqual({screen:'detail',id:'7'});
  expect(seen).toHaveBeenLastCalledWith({screen:'detail',id:'7'});
  // Another window or origin moves nothing.
  page.fire('message',{source:{},origin:APP,data:{type:'mx:url-values',search:'?$screen=x'}});
  page.fire('message',{source:page.parent,origin:'https://evil.test',data:{type:'mx:url-values',search:'?$screen=x'}});
  page.fire('message',{source:page.parent,origin:APP,data:{type:'mx:url-values',search:'?$big='+'x'.repeat(9000)}});
  expect(route.get()).toEqual({screen:'detail',id:'7'});
  expect(seen).toHaveBeenCalledTimes(3);
  // A link is the app's address for this page: `$` values only, never the frame's ticket.
  expect(route.href({screen:'detail',id:'9'})).toBe('https://app.test/a/p1?$screen=detail&$id=9');
 });
});
