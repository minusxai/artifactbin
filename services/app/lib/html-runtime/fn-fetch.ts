/**
 * PAGE FUNCTIONS FROM A PLAIN FETCH — `fetch('/fn/<name>', …)` in a page calls its backend function `<name>`.
 *
 * Installed by core (build.server's entry) before any author script runs, in every mode. Only a URL whose path starts
 * `/fn/` on the page's own origin, after the URL parser resolved it against the document (so `/fn/../graphql` is
 * `/graphql` and is not one), is a call; every other fetch goes to the browser's own fetch with the arguments it was
 * given, untouched, so CSP, CORS and credentials behave exactly as before. A call never touches the network from
 * the page: the reader (`callFunction`, ./browser-reader) relays it through the frame bridge to the app, which runs
 * it with the reader's sign-in (lib/page-graphql `pageFunction`).
 *
 * A call answers a real Response: the function's JSON with 200, or its refusal as a status (400, 403, 404, 405,
 * 409, 413, 500, 503) with `{error, message}`. It rejects only as fetch does: TypeError when the page has no
 * connection to the app (an offline copy, a frame that never attached), AbortError when its signal aborts.
 * Framework-free and value-free imports only: it is part of every page's core.
 */
export interface FunctionRequest {name:string;method:'GET'|'POST';search:string;body:string|null;contentType:string|null}
export interface FunctionReply {status:number;headers:Record<string,string>;body:string}
export type FunctionCaller=(request:FunctionRequest,signal:AbortSignal|null)=>Promise<FunctionReply>;
/** lib/page-operations FUNCTION_NAME, restated so core carries no server value (the parent checks it again). */
const NAME=/^[_A-Za-z][_0-9A-Za-z]{0,63}$/;
const PREFIX='/fn/';
const NULL_BODY=new Set([101,204,205,304]);

/** Replace `win.fetch`; returns the restore. `load` resolves the reader on the first call only. */
export function installFunctionFetch(win:Window,load:()=>Promise<{callFunction:FunctionCaller}>):()=>void{
 // Captured now, before the author's script can replace them.
 const scope=win as unknown as typeof globalThis;
 const native=win.fetch,apply=Reflect.apply,U=scope.URL,Req=scope.Request,Res=scope.Response,location=win.location,doc=win.document;
 // A host without fetch (a test's bare window) has nothing to intercept.
 if(typeof native!=='function'||typeof Req!=='function'||typeof Res!=='function'||typeof U!=='function')return ()=>{};
 const local=(status:number,error:string)=>new Res(JSON.stringify({error}),{status,headers:{'content-type':'application/json'}});
 const target=(input:unknown):URL|null=>{
  try{return new U(typeof input==='string'?input:input instanceof U?input.href:input instanceof Req?input.url:String(input),doc.baseURI);}catch{return null;}
 };
 async function call(url:URL,input:RequestInfo|URL,init:RequestInit|undefined):Promise<Response>{
  // The browser's own reading of (input, init): a GET with a body, a bad header and the like reject as fetch would.
  const request=new Req(input instanceof Req?input:url.href,init);
  const signal=request.signal;
  if(signal.aborted)throw signal.reason;
  const name=url.pathname.slice(PREFIX.length);
  if(!NAME.test(name))return local(404,'unknown_function');
  if(request.method!=='GET'&&request.method!=='POST')return local(405,'method_not_allowed');
  const body=request.method==='POST'?await request.text():null;
  const {callFunction}=await load();
  if(signal.aborted)throw signal.reason;
  const reply=await callFunction({name,method:request.method,search:url.search,body,contentType:request.headers.get('content-type')},signal);
  if(!Number.isInteger(reply.status)||reply.status<200||reply.status>599)throw new TypeError('Failed to fetch: invalid page function answer');
  return new Res(NULL_BODY.has(reply.status)?null:reply.body,{status:reply.status,headers:reply.headers});
 }
 const fetch=function fetch(...args:Parameters<typeof globalThis.fetch>):Promise<Response>{
  const url=target(args[0]);
  if(!url||url.origin!==new U(location.href).origin||!url.pathname.startsWith(PREFIX))return apply(native,win,args);
  return call(url,args[0],args[1]);
 };
 win.fetch=fetch;
 return ()=>{if(win.fetch===fetch)win.fetch=native;};
}
