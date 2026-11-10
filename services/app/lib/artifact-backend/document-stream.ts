/** One document connection per document/mode in this trusted browser realm (never across tabs).
 * Reader and region consumers own independent subscriptions. Replacing their union closes the old
 * transport before opening the new one, preserving both dataset and per-region catch-up positions.
 * This boundary has no Yjs or editor dependency, so ordinary readers stay lightweight.
 */
import { REGION_STREAM_EVENT, isCellKey } from '@artifactbin/contracts';
import { openLiveStream, type LiveStream, type LiveStreamOptions } from '@/lib/http/live-stream';
interface Consumer { options:LiveStreamOptions; regions:boolean }
interface Hub { consumers:Set<Consumer>; stream:LiveStream|null; cursor:string; restart():void }
const hubs=new Map<string,Hub>();
function subscribe(id:string,options:LiveStreamOptions,regions:boolean,anonymous=false):LiveStream {
 const key=`${anonymous?'anonymous':'session'}:${id}`;
 let hub=hubs.get(key);
 if(!hub){
  const own:Hub={consumers:new Set(),stream:null,cursor:'',restart(){
   own.stream?.close();own.stream=null;
   if(!own.consumers.size){hubs.delete(key);return;}
   const notify=(run:(c:Consumer)=>void)=>{for(const c of [...own.consumers])if(own.consumers.has(c))run(c);};
   own.stream=openLiveStream({url:()=>{
    const params=new URLSearchParams();if(anonymous)params.set('anonymous','1');
    if(own.cursor)params.set('since',own.cursor);
    const cursors=new Map<string,number>();
    for(const c of own.consumers)if(c.regions){
     const url=typeof c.options.url==='function'?c.options.url():c.options.url;
     const after=new URL(url,'http://local.invalid').searchParams.get('after')??'';
     for(const pair of after.split(',')){const at=pair.lastIndexOf(':');if(at<1)continue;const region=pair.slice(0,at),seq=Number(pair.slice(at+1));cursors.set(region,Math.min(cursors.get(region)??seq,seq));}
    }
    if(cursors.size)params.set('regions',[...cursors].map(([region,seq])=>`${region}:${seq}`).join(','));
    return `/a/${encodeURIComponent(id)}/events${params.size?`?${params}`:''}`;
   },onCursor:cursor=>{own.cursor=cursor;},
   onMessage:data=>notify(c=>{if(!c.regions)c.options.onMessage?.(data);}),
   events:{
    ...Object.fromEntries([...new Set([...own.consumers].filter(c=>!c.regions).flatMap(c=>Object.keys(c.options.events??{})))].map(name=>[name,(data:string)=>notify(c=>{if(!c.regions)c.options.events?.[name]?.(data);})])),
    [REGION_STREAM_EVENT]:(data:string)=>notify(c=>{if(c.regions)c.options.onMessage?.(data);}),
   },onReconnect:()=>notify(c=>c.options.onReconnect?.()),onWake:()=>notify(c=>c.options.onWake?.()),onError:()=>notify(c=>c.options.onError?.()),
   });
  }};
  hub=own;hubs.set(key,own);
 }
 const current=hub;
 // A new reader may supply its SSR dataset cursor; never overwrite a cursor already delivered.
 if(!regions&&!current.cursor){const url=typeof options.url==='function'?options.url():options.url;current.cursor=new URL(url,'http://local.invalid').searchParams.get('since')??'';}
 const consumer={options,regions};current.consumers.add(consumer);current.restart();
 let closed=false;
 return {close(){if(closed)return;closed=true;current.consumers.delete(consumer);current.restart();}};
}
export function openDocumentStream(id:string,options:LiveStreamOptions,anonymous=false):LiveStream{return subscribe(id,options,false,anonymous);}
export function openDocumentRegionStream(id:string,options:LiveStreamOptions):LiveStream {
 const url=typeof options.url==='function'?options.url():options.url;
 const after=new URL(url,'http://local.invalid').searchParams.get('after')??'';
 // Dataset cells have a distinct reader/write authority and retain their existing standalone door.
 if(after.split(',').some(pair=>isCellKey(pair.slice(0,pair.lastIndexOf(':')))))return openLiveStream(options);
 return subscribe(id,options,true);
}
