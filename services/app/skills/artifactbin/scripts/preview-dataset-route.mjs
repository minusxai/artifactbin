/**
 * Internal: the preview server's local dataset endpoints (/__af_preview/datasets/ID[/status|export|
 * discard]): bounded GraphQL operations against the in-memory session, plus export and discard.
 * Used by: preview.mjs.
 */
export const DATASET_ROUTE=new RegExp('^/__af_preview/datasets/([A-Za-z0-9_-]+)'+
  '(?:/(export|status|discard)(?:/([A-Za-z_][A-Za-z0-9_]*))?)?$');

/** Answer one dataset request; `route` is the DATASET_ROUTE match, `end` writes status and body. */
export async function handleDatasetRoute({req,res,end,route,sessions,operationTimeoutMs}){
   try {
const session=sessions.get(route[1],{allowObsolete:!!route[2]});res.setHeader(
      'Content-Type','application/json');
if(route[2]==='status'){if(req.method!=='GET')return end(405,'Status requires GET');
      return end(200,JSON.stringify(await sessions.status(route[1])));}
if(route[2]==='export'){if(req.method!=='GET')return end(405,'Export requires GET');if(
      !session.names.has(route[3]))return end(404,'Unknown local namespace');res.setHeader(
      'Content-Disposition',`attachment; filename="local-${route[3]}.json"`);return end(200,
      JSON.stringify(session.adapter.export(route[3])));}
    // Discard drops unsaved edits, so it must be a bodiless same-origin POST.
if(route[2]==='discard'){if(req.headers['transfer-encoding']||Number(req.headers[
      'content-length']??0)>0)return end(413,'Discard does not accept a body');if(
      req.method!=='POST'||req.headers.origin!==`http://${req.headers.host}`)return end(403,
      'Same-origin POST required');sessions.discard(route[1]);req.resume();return end(200,
      JSON.stringify({discarded:true}));}
    if(req.method!=='POST')return end(405,'Local operations require POST');
    if(req.headers.origin!==`http://${req.headers.host}`)return end(403,'Origin required');
if((req.headers['content-type']??'').split(';')[0]!=='application/json')return end(415,
      'JSON required');
    // At most 4 concurrent and 512 total operations per session.
if(session.active>=4)return end(429,JSON.stringify({error:
      'Too many local operations; retry shortly.'}));
if(session.operations>=512)return end(429,JSON.stringify({error:
      'Local session operation limit reached; export edits and restart the preview.'}));
    session.active++;session.operations++;
    try {
const request=await readJsonBody(req);const controller=new AbortController();
       const timer=setTimeout(
       ()=>controller.abort(Error('Local operation timed out')),operationTimeoutMs);
try {const result=await session.adapter.execute(request,controller.signal);return end(200,
       JSON.stringify(result));}finally{clearTimeout(timer);}
    }finally{session.active--;await sessions.status(route[1]);}
}catch(error){res.setHeader('Content-Type','application/json');return end(error.status??(
     error.code==='PREVIEW_LIMIT'?413:400),JSON.stringify({error:error.message}));}
}

/** Read a JSON GraphQL request body: 64 KiB, 5 s; errors carry the HTTP status to answer with. */
async function readJsonBody(request){
 return await new Promise((done,reject)=>{
  const chunks=[];let size=0,finished=false;
const timer=setTimeout(()=>finish(Object.assign(Error('Local request body timed out'),{status:
    408})),5000);
function finish(error){if(finished)return;finished=true;clearTimeout(timer);request.removeListener(
    'data',data);request.removeListener('end',end);request.removeListener('aborted',aborted);if(
    error){request.resume();reject(error);}else{try{const value=JSON.parse(Buffer.concat(
    chunks).toString('utf8'));if(!value||typeof value.query!=='string')throw Error(
    'A GraphQL query string is required');done(value);}catch(error){reject(Object.assign(error,{
    status:400}));}}}
function data(chunk){size+=chunk.length;if(size>65536)return finish(Object.assign(Error(
    'Local request exceeds 64 KiB'),{status:413}));chunks.push(chunk);}
function end(){finish();}function aborted(){finish(Object.assign(Error('Local request aborted'),{
    status:400}));}
request.on('data',data);request.once('end',end);request.once('aborted',aborted);request.once(
    'error',error=>finish(Object.assign(error,{status:400})));
 });
}
