import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../build-portable-chrome.server',()=>({buildPortableChrome:async()=>'',buildHostComments:async()=>''}));
import {buildHtmlAssets} from '../build.server';
afterEach(()=>{vi.unstubAllGlobals();});
/** The built apollo with its bare runtime imports (`@afbin/reader`, and `@afbin/state`, which also imports the reader) bound to data URLs, as the page's import map binds them. */
const dataUrl=(code:string)=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
function linked(assets:{apollo:string;state?:string},readerUrl:string){
 if(!assets.state)throw Error("the runtime build emitted no @afbin/state module");
 const bindReader=(code:string)=>code.replace(/(["'])@afbin\/reader\1/g,JSON.stringify(readerUrl));
 const stateUrl=dataUrl(bindReader(assets.state));
 return bindReader(assets.apollo).replace(/(["'])@afbin\/state\1/g,JSON.stringify(stateUrl));
}
it('the emitted author module watches backend results with explicit loading without persisting them',async()=>{
 const assets=await buildHtmlAssets();
 vi.stubGlobal('document',{querySelector:()=>null});vi.stubGlobal('location',{hash:''});
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('navigator',{});
 vi.stubGlobal('addEventListener',()=>{});vi.stubGlobal('removeEventListener',()=>{});
 let finish!:(value:unknown)=>void;
 const fixture={config:{pageId:'built-watch',revision:'1',backends:['orders'],initialState:{filter:'private'}},remote:{online:()=>true,execute:()=>new Promise(resolve=>{finish=resolve;})},startFrameBridge(){},onResolverChange(){return {unsubscribe(){}};},remoteReadOnly:false,uploadFile:()=>{throw Error("No upload fixture");},watchUploadContext:()=>({unsubscribe(){}}),bindFileUpload:()=>()=>{}};
 vi.stubGlobal('__builtWatchReader',fixture);
 const reader='const r=globalThis.__builtWatchReader;export const {config,remote,startFrameBridge,onResolverChange,remoteReadOnly,uploadFile,watchUploadContext,bindFileUpload}=r;';
 const readerUrl='data:text/javascript;base64,'+Buffer.from(reader).toString('base64');
 const source=linked(assets,readerUrl);
 const runtime=await import(/* @vite-ignore */ 'data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 expect(runtime.watchUploadContext).toBeTypeOf('function');
 expect(runtime.bindFileUpload).toBeTypeOf('function');
 expect(runtime).not.toHaveProperty('client');expect(runtime).not.toHaveProperty('gql');
 const results:unknown[]=[];
 const stop=runtime.sql.watch(runtime.sql`select total from orders`,(value:unknown)=>results.push(value));
 expect(results).toEqual([]);
 finish({rows:[{total:17}],columns:[{name:'total',type:'number'}]});
 for(let i=0;i<12;i++)await Promise.resolve();
 expect(results.at(-1)).toMatchObject([{total:17}]);
 expect(runtime.readViewerDocument()).toEqual({filter:'private'});
 stop();
});

it('the supported onResolverChange listener subscribes through the built runtime',async()=>{
 const assets=await buildHtmlAssets();
 vi.stubGlobal('document',{querySelector:()=>null});vi.stubGlobal('location',{hash:''});
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('navigator',{});
 vi.stubGlobal('addEventListener',()=>{});vi.stubGlobal('removeEventListener',()=>{});
 const listeners:Function[]=[];
 const fixture={config:{pageId:'legacy-name',revision:'1',backends:['orders'],initialState:{}},remote:{online:()=>true,execute:async()=>({data:{}})},startFrameBridge(){},onResolverChange(listener:Function){listeners.push(listener);return {unsubscribe(){}};},remoteReadOnly:false,uploadFile:()=>{throw Error('unused');},watchUploadContext(){},bindFileUpload(){}};
 vi.stubGlobal('__legacyNameReader',fixture);
 const reader='const r=globalThis.__legacyNameReader;export const {config,remote,startFrameBridge,onResolverChange,remoteReadOnly,uploadFile,watchUploadContext,bindFileUpload}=r;';
 const source=linked(assets,dataUrl(reader));
 const runtime=await import(/* @vite-ignore */ 'data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const changed:unknown[]=[];
 expect(runtime.onBackendChange).toBeUndefined();
 runtime.onResolverChange((names:string[])=>changed.push(names)).unsubscribe();
 listeners.at(-1)!(['orders']);
 expect(changed).toEqual([['orders']]);
});

it('the emitted @afbin/state exports seat() and route beside state: a page reads where it runs and keeps its screen in `$` values',async()=>{
 const assets=await buildHtmlAssets();
 const pushed:string[]=[];let href='https://abc.pages.test/?$screen=home';
 const location={get href(){return href;},get search(){return new URL(href).search;},get pathname(){return new URL(href).pathname;},get hash(){return new URL(href).hash;}};
 const win:Record<string,unknown>={origin:'https://abc.pages.test',location,history:{state:null,pushState(_s:unknown,_t:string,next:string){href=new URL(next,href).href;pushed.push(href);},replaceState(_s:unknown,_t:string,next:string){href=new URL(next,href).href;}},addEventListener(){},removeEventListener(){}};
 for(const [name,value] of Object.entries(win))vi.stubGlobal(name,value);vi.stubGlobal('parent',globalThis);
 vi.stubGlobal('document',{querySelector:()=>null});
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('navigator',{});
 vi.stubGlobal('__seatReader',{config:{pageId:'seat-page',revision:'1',backends:[],appOrigin:'https://app.test'},remote:{online:()=>false}});
 const reader=dataUrl('const r=globalThis.__seatReader;export const {config,remote}=r;');
 const state=await import(/* @vite-ignore */ dataUrl(assets.state!.replace(/(["'])@afbin\/reader\1/g,JSON.stringify(reader))));
 expect(state.state.getState()).toEqual({});
 expect(state.seat()).toEqual({kind:'address',pageId:'seat-page',sql:false,writes:false});
 expect(state.route.get()).toEqual({screen:'home'});
 state.route.set({screen:'detail',id:'4'},{push:true});
 expect(pushed).toEqual(['https://abc.pages.test/?$screen=detail&$id=4']);
 expect(state.route.href({screen:'list'})).toBe('https://abc.pages.test/?$screen=list');
});
