/**
 * PAGE FUNCTIONS FROM A PLAIN FETCH — `fetch('/fn/<name>', …)` in a page calls its backend function `<name>`.
 *
 * Installed by core (build.server's entry) before any author script runs, in every mode. Only a URL whose path starts
 * `/fn/` on the page's own origin, after the URL parser resolved it against the document (so `/fn/../graphql` is
 * `/graphql` and is not one), is a call; every other fetch goes to the browser's own fetch with the arguments it was
 * given, untouched, so CSP, CORS and credentials behave exactly as before. A call never touches the network from
 * the page: the reader (`callFunction`, ./browser-reader) relays it through the frame bridge to the app, which runs
 * it with the reader's sign-in (lib/page-doors `pageFunction`).
 *
 * A call answers a real Response: the function's JSON with 200, or its refusal as a status (400, 403, 404, 405,
 * 409, 413, 500, 503) with `{error, message}`. It rejects only as fetch does: TypeError when the page has no
 * connection to the app (an offline copy, a frame that never attached), AbortError when its signal aborts.
 * A FILE PUBLISHED WITH THE PAGE — `fetch('./data.json')` reads the file the page's publication recorded at that path.
 * `files` (the runtime config's table, lib/html-publication-bundle publishedFileTable) maps each recorded path, relative
 * to the page, to where it is read: the page's own asset door (which checks the reader on every request) or, in an
 * offline copy, its bytes. A request whose URL, resolved against the document as the browser resolves it, is one of
 * those paths on the page's own origin goes to the browser's own fetch at that address, its query and hash dropped (the
 * stored file does not vary by them) and a Request's method, headers, body and signal kept; nothing else is touched.
 *
 * Framework-free and value-free imports only: it is part of every page's core.
 */
export interface FunctionRequest {name:string;method:'GET'|'POST';search:string;body:string|null;contentType:string|null}
export interface FunctionReply {status:number;headers:Record<string,string>;body:string}
export type FunctionCaller=(request:FunctionRequest,signal:AbortSignal|null)=>Promise<FunctionReply>;
/** lib/page-operations FUNCTION_NAME, restated so core carries no server value (the parent checks it again). */
const NAME=/^[_A-Za-z][_0-9A-Za-z]{0,63}$/;
const PREFIX='/fn/';
const NULL_BODY=new Set([101,204,205,304]);

/** Replace `win.fetch`; returns the restore. `load` resolves the reader on the first call only; `files`: path -> address. */
export function installFunctionFetch(win:Window,load:()=>Promise<{callFunction:FunctionCaller}>,files?:Readonly<Record<string,string>>):()=>void{
 // Captured now, before the author's script can replace them.
 const scope=win as unknown as typeof globalThis;
 const native=win.fetch,apply=Reflect.apply,U=scope.URL,Req=scope.Request,Res=scope.Response,location=win.location,doc=win.document;
 // A host without fetch (a test's bare window) has nothing to intercept.
 if(typeof native!=='function'||typeof Req!=='function'||typeof Res!=='function'||typeof U!=='function')return ()=>{};
 // Resolved once: the document's base never moves (every served policy says base-uri 'none').
 const published=new Map<string,string>();
 for(const [name,address] of Object.entries(files??{}))try{const at=new U(name,doc.baseURI);published.set(at.origin+at.pathname,new U(address,doc.baseURI).href);}catch{}
 const local=(status:number,error:string)=>new Res(JSON.stringify({error}),{status,headers:{'content-type':'application/json'}});
 const target=(input:string|URL|Request):URL|null=>{
  try{return new U(typeof input==='string'?input:input instanceof Req?input.url:input.href,doc.baseURI);}catch{return null;}
 };
 // A stage (`start`: the body read, loading the reader, the bridge call) raced against the signal: never started once
 // the signal has aborted, rejected the moment it aborts, its listener gone when it settles.
 const until=<T,>(start:()=>Promise<T>,signal:AbortSignal):Promise<T>=>new Promise<T>((resolve,reject)=>{
  if(signal.aborted){reject(signal.reason);return;}
  const stop=()=>reject(signal.reason);
  signal.addEventListener('abort',stop,{once:true});
  let work:Promise<T>;
  try{work=start();}catch(error){work=Promise.reject(error);}
  void work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));
 });
 async function call(url:URL,input:string|URL|Request,init:RequestInit|undefined):Promise<Response>{
  // The browser's own reading of (input, init): a GET with a body, a bad header and the like reject as fetch would.
  const request=new Req(input instanceof Req?input:url.href,init);
  const signal=request.signal;
  if(signal.aborted)throw signal.reason;
  const name=url.pathname.slice(PREFIX.length);
  if(!NAME.test(name))return local(404,'unknown_function');
  const method=request.method;
  if(method!=='GET'&&method!=='POST')return local(405,'method_not_allowed');
  const body=method==='POST'?await until(()=>request.text(),signal):null;
  const {callFunction}=await until(load,signal);
  const reply=await until(()=>callFunction({name,method,search:url.search,body,contentType:request.headers.get('content-type')},signal),signal);
  if(!Number.isInteger(reply.status)||reply.status<200||reply.status>599)throw new TypeError('Failed to fetch: invalid page function answer');
  return new Res(NULL_BODY.has(reply.status)?null:reply.body,{status:reply.status,headers:reply.headers});
 }
 const fetch=function fetch(...args:Parameters<typeof globalThis.fetch>):Promise<Response>{
  if(!args.length)return apply(native,win,args);
  // Inspect and convert a URL-like input ONCE, inside the try, as fetch's own conversion would (a template literal: a
  // Symbol throws, as there; a revoked Proxy throws on the type checks): its failure is a rejection, never a throw,
  // and the same converted value goes on, so a stateful toString never runs twice.
  let input:string|URL|Request,url:URL|null;
  try{
   const given:unknown=args[0];
   input=typeof given==='string'||given instanceof U||given instanceof Req?given:`${given as string}`;
   url=target(input);
  }catch(error){return Promise.reject(error);}
  const file=url&&url.origin===new U(location.href).origin&&published.get(url.origin+url.pathname);
  // A Request rebuilt at the file's address (its body already read rejects, as fetch would).
  if(file){try{return apply(native,win,[input instanceof Req?new Req(file,input):file,...args.slice(1)]);}catch(error){return Promise.reject(error);}}
  if(!url||url.origin!==new U(location.href).origin||!url.pathname.startsWith(PREFIX))return apply(native,win,[input,...args.slice(1)]);
  return call(url,input,args[1]);
 };
 win.fetch=fetch;
 return ()=>{if(win.fetch===fetch)win.fetch=native;};
}
