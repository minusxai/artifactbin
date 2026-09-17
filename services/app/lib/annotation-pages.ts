import type {AnnotationWire} from './annotations';
/** The document overlay needs all roots, while HTTP keeps each response bounded. */
export async function readAnnotationPages(url:string,options:RequestInit={}):Promise<AnnotationWire[]>{
 const annotations=new Map<string,AnnotationWire>(),seen=new Set<string>();let cursor:string|undefined;
 for(;;){
  const page=cursor?`${url}${url.includes('?')?'&':'?'}cursor=${encodeURIComponent(cursor)}`:url;
  const response=await fetch(page,{credentials:'same-origin',...options});
  if(!response.ok)throw new Error(`Annotation read failed (HTTP ${response.status})`);
  const body=await response.json();if(!Array.isArray(body.annotations))throw new Error('Invalid annotation page');
  for(const annotation of body.annotations)annotations.set(annotation.id,annotation);
  if(body.next_cursor==null)return[...annotations.values()];
  if(typeof body.next_cursor!=='string'||!body.next_cursor||seen.has(body.next_cursor))throw new Error('Invalid annotation cursor');
  seen.add(body.next_cursor);cursor=body.next_cursor;
 }
}
