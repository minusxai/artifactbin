import {servableDocument,type ArtifactRow} from '@/lib/artifacts';
import {authorHandle} from '@/lib/accounts';
import {loadDatasetRows} from '@/lib/datasets';
/** Stateless native version payload. HTML readers reload source through the native document door. */
let builds=0;
export const resetFrameCache=()=>cache.clear();
export const frameBuilds=()=>builds;
async function build(stored:ArtifactRow){
 builds++;
 const row=servableDocument(stored);
 return {editId:row.edit_id,version:row.version,by:await authorHandle(row),format:row.format,title:row.title,
 heading:null,source:null,dataPreview:row.format==='dataset'?JSON.stringify(await loadDatasetRows(row)):row.format==='viz'?row.source:null,
 compiledCss:null,authorCss:null,authorScript:null,declarations:null,datasets:[],theme:null,colorMode:null,template:null};
}

const cache=new Map<string,ReturnType<typeof build>>();
export function liveFrameFor(row:ArtifactRow){
 const key=`${row.id}:${row.edit_id}`;
 let frame=cache.get(key);
 if(!frame){frame=build(row).catch(error=>{cache.delete(key);throw error;});cache.set(key,frame);if(cache.size>64)cache.delete(cache.keys().next().value!);}
 return frame;
}
