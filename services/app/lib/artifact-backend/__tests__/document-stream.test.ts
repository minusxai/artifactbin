import { afterEach, expect, it, vi } from 'vitest';
import { createReaderHttpBackend } from '../reader-http';
import { createRegionClient } from '../region-http';
class Source {
 static all:Source[]=[];
 closed=false; onmessage:((e:MessageEvent)=>void)|null=null; onerror:(()=>void)|null=null; onopen:(()=>void)|null=null;
 listeners:Record<string,(e:MessageEvent)=>void>={};
 constructor(readonly url:string){Source.all.push(this);}
 addEventListener(name:string,cb:(e:MessageEvent)=>void){this.listeners[name]=cb;}
 close(){this.closed=true;}
 emit(name:string,data:unknown,id=''){const e={data:JSON.stringify(data),lastEventId:id} as MessageEvent;(name==='message'?this.onmessage:this.listeners[name])?.(e);}
}
const stops:Array<()=>void>=[];
afterEach(()=>{stops.splice(0).forEach(stop=>stop());vi.unstubAllGlobals();Source.all=[];});
const live=()=>Source.all.filter(s=>!s.closed);
function setup(){
 vi.stubGlobal('EventSource',Source);
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({regionId:'af-1',kind:'text',clientId:7,seq:0,state:'AAA=',savedVersion:1})));
 const ping=vi.fn(),remote=vi.fn();
 const stop=createReaderHttpBackend('Page123').live({onPing:ping,onData:vi.fn(),onAnnotations:vi.fn()});stops.push(stop);
 const client=createRegionClient('Page123',{remote,ack:vi.fn(),closed:vi.fn(),saved:vi.fn()});stops.push(()=>client.dispose());
 return {stop,client,ping,remote};
}
it('shares one document connection for reader and editor, delivering both authorized channels',async()=>{
 const {client,ping,remote}=setup();await client.open('af-1');
 expect(live()).toHaveLength(1);
 expect(live()[0]!.url).toContain('/a/Page123/events');
 live()[0]!.emit('message',{version:2,editId:'v2'});
 live()[0]!.emit('regions',{type:'updates',regionId:'af-1',from:1,to:1,updates:['AAA=']});
 expect(ping).toHaveBeenCalledWith({version:2,editId:'v2'});expect(remote).toHaveBeenCalledTimes(1);
 // Duplicate notifications do not replay a remote update.
 live()[0]!.emit('regions',{type:'updates',regionId:'af-1',from:1,to:1,updates:['AAA=']});expect(remote).toHaveBeenCalledTimes(1);
});
it('reader unsubscribe leaves editor live; last consumer closes; another document stays isolated',async()=>{
 const {client,stop,remote}=setup();await client.open('af-1');
 const other=vi.fn();const stopOther=createReaderHttpBackend('Other123').live({onPing:other,onData:vi.fn(),onAnnotations:vi.fn()});stops.push(stopOther);
 stop();expect(live()).toHaveLength(2);
 live().find(s=>s.url.includes('Page123'))!.emit('regions',{type:'updates',regionId:'af-1',from:1,to:1,updates:['AAA=']});
 expect(remote).toHaveBeenCalledTimes(1);expect(other).not.toHaveBeenCalled();
 client.dispose();expect(live()).toHaveLength(1);stopOther();expect(live()).toHaveLength(0);
});
it('retains reader cursor and region sequence when changing region subscriptions',async()=>{
 const {client}=setup();await client.open('af-1');
 live()[0]!.emit('message',{version:1,editId:'v1'},'dataset-cursor');
 live()[0]!.emit('regions',{type:'updates',regionId:'af-1',from:1,to:1,updates:['AAA=']});
 client.leave();client.resume();
 expect(live()).toHaveLength(1);
 const url=new URL(live()[0]!.url,'http://localhost');
 expect(url.searchParams.get('regions')).toBe('af-1:1');expect(url.searchParams.get('since')).toBe('dataset-cursor');
});
it('region detach preserves reader and ignores frames from the superseded transport',async()=>{
 const {client,ping,remote}=setup();await client.open('af-1');const old=live()[0]!;
 client.dispose();expect(live()).toHaveLength(1);expect(live()[0]!.url).not.toContain('regions=');
 old.emit('regions',{type:'updates',regionId:'af-1',from:1,to:1,updates:['AAA=']});expect(remote).not.toHaveBeenCalled();
 live()[0]!.emit('message',{version:3,editId:'next'});expect(ping).toHaveBeenCalledWith({version:3,editId:'next'});
});
it('reconnect resumes both positions and heals a region gap without replaying duplicates',async()=>{
 vi.useFakeTimers();try {
 const {client,remote}=setup();await client.open('af-1');
 live()[0]!.emit('message',{version:1},'dataset-checkpoint');
 live()[0]!.emit('regions',{type:'updates',regionId:'af-1',from:1,to:1,updates:['AAA=']});
 live()[0]!.onerror?.();await vi.advanceTimersByTimeAsync(1000);
 expect(live()).toHaveLength(1);expect(new URL(live()[0]!.url,'http://local').searchParams.get('regions')).toBe('af-1:1');
 expect(new URL(live()[0]!.url,'http://local').searchParams.get('since')).toBe('dataset-checkpoint');
 live()[0]!.emit('regions',{type:'updates',regionId:'af-1',from:3,to:3,updates:['AAA=']});
 expect(remote).toHaveBeenCalledTimes(1);
 expect(new URL(live()[0]!.url,'http://local').searchParams.get('regions')).toBe('af-1:1');
 live()[0]!.emit('regions',{type:'updates',regionId:'af-1',from:2,to:3,updates:['AAA=','AAA=']});
 expect(remote).toHaveBeenCalledTimes(2);expect(remote.mock.calls[1]![2]).toBe(3);
 }finally{vi.useRealTimers();}
});
it('anonymous readers never share the editor connection',async()=>{
 const {client}=setup();await client.open('af-1');
 const stop=createReaderHttpBackend('Page123',{anonymous:true}).live({onPing:vi.fn(),onData:vi.fn(),onAnnotations:vi.fn()});stops.push(stop);
 expect(live()).toHaveLength(2);expect(live().find(s=>s.url.includes('anonymous=1'))!.url).not.toContain('regions=');
});
it('switching region sessions forgets old subscriptions without affecting document readers',async()=>{
 const {client,remote}=setup();await client.open('af-1');client.close('af-1');
 vi.mocked(fetch).mockResolvedValue(Response.json({regionId:'af-2',kind:'rich-native-v1',clientId:8,seq:4,state:'AAA=',savedVersion:1}));
 await client.open('af-2');expect(live()).toHaveLength(1);
 expect(new URL(live()[0]!.url,'http://local').searchParams.get('regions')).toBe('af-2:4');
 live()[0]!.emit('regions',{type:'updates',regionId:'af-1',from:1,to:1,updates:['AAA=']});expect(remote).not.toHaveBeenCalled();
 live()[0]!.emit('regions',{type:'updates',regionId:'af-2',from:5,to:5,updates:['AAA=']});expect(remote).toHaveBeenCalledTimes(1);
});
it('dataset cell sessions retain their independently authorized standalone transport',async()=>{
 const {client}=setup();
 vi.mocked(fetch).mockResolvedValue(Response.json({regionId:'cell:items:r_1:title',kind:'text',clientId:8,seq:0,state:'AAA=',savedVersion:1}));
 await client.open('cell:items:r_1:title');
 expect(live()).toHaveLength(2);
 expect(live().some(s=>s.url.startsWith('/api/artifacts/Page123/regions/stream?after=cell:'))).toBe(true);
 expect(live().find(s=>s.url.startsWith('/a/'))!.url).not.toContain('regions=');
});
it('pending updates retry through multiplex reconnect without losing their bytes',async()=>{
 vi.useFakeTimers();try {
 const {client}=setup();await client.open('af-1');
 const posted:string[]=[];let fail=true;
 vi.mocked(fetch).mockImplementation(async(_url,init)=>{posted.push(String(init?.body));if(fail)return Response.json({error:'busy'},{status:503});return Response.json({seq:1});});
 client.push('af-1',new Uint8Array([0,0]));await vi.advanceTimersByTimeAsync(50);expect(posted).toHaveLength(1);
 live()[0]!.onerror?.();fail=false;await vi.advanceTimersByTimeAsync(1000);
 live()[0]!.emit('keepalive',{});await vi.advanceTimersByTimeAsync(0);
 expect(posted.length).toBeGreaterThanOrEqual(2);expect(posted.every(body=>body===posted[0])).toBe(true);
 }finally{vi.useRealTimers();}
});
