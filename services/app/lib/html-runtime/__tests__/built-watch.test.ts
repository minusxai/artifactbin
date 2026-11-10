import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../build-portable-chrome.server',()=>({buildPortableChrome:async()=>''}));
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
 const fixture={config:{pageId:'built-watch',revision:'1',backends:['orders'],initialState:{filter:'private'}},remote:{online:()=>true,execute:()=>new Promise(resolve=>{finish=resolve;})},startFrameBridge(){},onResolverChange(){},remoteReadOnly:false,uploadFile:()=>{throw Error("No upload fixture");},watchUploadContext:()=>({unsubscribe(){}}),bindFileUpload:()=>()=>{}};
 vi.stubGlobal('__builtWatchReader',fixture);
 const reader='const r=globalThis.__builtWatchReader;export const {config,remote,startFrameBridge,onResolverChange,remoteReadOnly,uploadFile,watchUploadContext,bindFileUpload}=r;';
 const readerUrl='data:text/javascript;base64,'+Buffer.from(reader).toString('base64');
 const source=linked(assets,readerUrl);
 const runtime=await import(/* @vite-ignore */ 'data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 expect(runtime.watchUploadContext).toBeTypeOf('function');
 expect(runtime.bindFileUpload).toBeTypeOf('function');
 const results:any[]=[];
 const subscription=runtime.client.watchQuery({query:runtime.gql`{orders{total} filter}`,clearOnRefresh:true}).subscribe((value:unknown)=>results.push(value));
 expect(results.at(-1)).toEqual({data:{filter:'private',orders:null},loading:true});
 finish({data:{orders:{total:17}}});
 for(let i=0;i<12;i++)await Promise.resolve();
 expect(results.at(-1)).toEqual({data:{filter:'private',orders:{total:17}},loading:false});
 expect(runtime.readViewerDocument()).toEqual({filter:'private'});
 subscription.unsubscribe();
});

it('a published page that calls onBackendChange still subscribes through the built runtime (live-page compatibility)',async()=>{
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
 expect(runtime.onBackendChange).toBe(runtime.onResolverChange);
 runtime.onBackendChange((names:string[])=>changed.push(names)).unsubscribe();
 listeners.at(-1)!(['orders']);
 expect(changed).toEqual([['orders']]);
});
