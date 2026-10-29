import {afterEach,expect,it,vi} from 'vitest';
import {createReaderHttpBackend} from '../reader-http';
afterEach(()=>vi.unstubAllGlobals());
it('keeps reader head, frame and presence HTTP requests and refusal behavior',async()=>{
 const fetch=vi.fn(async()=>Response.json({id:'Page123',version:2}));vi.stubGlobal('fetch',fetch);
 const backend=createReaderHttpBackend('Page123');expect(backend.unavailable('live')).toBeNull();
 expect(await backend.load()).toMatchObject({version:2});expect(fetch).toHaveBeenLastCalledWith('/api/my/artifacts/Page123');
 expect(await backend.liveFrame()).toMatchObject({version:2});expect(fetch).toHaveBeenLastCalledWith('/a/Page123/events/frame',{credentials:'same-origin'});
 const publication={session:'session',revision:'2',visible:false,cursor:null,selection:null};
 expect(await backend.publishPresence(publication)).toBe('Page123');expect(fetch).toHaveBeenLastCalledWith('/api/artifacts/Page123/presence',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(publication),keepalive:true});
 fetch.mockImplementation(async()=>Response.json({}, {status:404}));
 expect(await backend.load()).toBeNull();expect(await backend.liveFrame()).toBeNull();expect(await backend.publishPresence(publication)).toBeNull();
});
it('preserves resumable live pings, data, annotations and presence until unsubscribe',()=>{
 const sources:Array<{url:string;onmessage:((e:{data:string})=>void)|null;listeners:Record<string,(e:{data:string})=>void>;closed:boolean}>=[];
 vi.stubGlobal('EventSource',class{onmessage=null;listeners:Record<string,(e:{data:string})=>void>={};closed=false;constructor(public url:string){sources.push(this);}addEventListener(name:string,fn:(e:{data:string})=>void){this.listeners[name]=fn;}close(){this.closed=true;}});
 const onPing=vi.fn(),onData=vi.fn(),onAnnotations=vi.fn(),onPresence=vi.fn();
 const stop=createReaderHttpBackend('Page123').live({onPing,onData,onAnnotations,onPresence},{since:'cursor/1'}),source=sources[0]!;
 expect(source.url).toBe('/a/Page123/events?since=cursor%2F1');
 source.onmessage!({data:JSON.stringify({version:3,editId:'e3'})});expect(onPing).toHaveBeenCalledWith({version:3,editId:'e3'});
 source.listeners.data!({data:JSON.stringify({datasets:['votes'],version:3})});expect(onData).toHaveBeenCalledWith({datasets:['votes'],version:3});
 source.listeners.annotations!({data:'{}'});expect(onAnnotations).toHaveBeenCalledOnce();
 source.listeners.presence!({data:JSON.stringify({viewers:[{id:'peer',label:'Reader'}],total:30})});expect(onPresence).toHaveBeenCalledWith({viewers:[{id:'peer',label:'Reader'}],total:30});source.listeners.presence!({data:JSON.stringify({viewers:[],total:'many'})});expect(onPresence).toHaveBeenCalledTimes(1);
 source.onmessage!({data:'broken'});expect(onPing).toHaveBeenCalledOnce();stop();expect(source.closed).toBe(true);
});

it('reads every annotation page with the same status and cancellation signal',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({annotations:[{id:'one'}],next_cursor:'next'})).mockResolvedValueOnce(Response.json({annotations:[{id:'two'}],next_cursor:null}));vi.stubGlobal('fetch',fetch);
 const signal=new AbortController().signal;
 expect(await createReaderHttpBackend('Page123').listAnnotations('open',{signal})).toEqual([{id:'one'},{id:'two'}]);
 expect(fetch).toHaveBeenNthCalledWith(1,'/api/my/artifacts/Page123/annotations?status=open',{credentials:'same-origin',signal});
 expect(fetch).toHaveBeenNthCalledWith(2,'/api/my/artifacts/Page123/annotations?status=open&cursor=next',{credentials:'same-origin',signal});
});
it('keeps local live reads and ephemeral presence anonymous even with ambient account cookies',async()=>{
 const fetch=vi.fn().mockImplementation(async(url)=>Response.json(String(url).includes('annotations')?{annotations:[]}:{id:'Guest'}));vi.stubGlobal('fetch',fetch);const urls:string[]=[];vi.stubGlobal('EventSource',class{onmessage=null;onopen=null;onerror=null;constructor(url:string){urls.push(url);}addEventListener(){}close(){}});
 const backend=createReaderHttpBackend('Page123',{anonymous:true});await backend.load();await backend.liveFrame();await backend.listAnnotations();await backend.publishPresence({session:'s',revision:'1',visible:true,cursor:null,selection:null});for(const call of fetch.mock.calls)expect(call[1]).toMatchObject({credentials:'omit'});const stop=backend.live({onPing:vi.fn(),onData:vi.fn(),onAnnotations:vi.fn()},{since:'cursor/1'});expect(urls).toEqual(['/a/Page123/events?anonymous=1&since=cursor%2F1']);stop();
});
