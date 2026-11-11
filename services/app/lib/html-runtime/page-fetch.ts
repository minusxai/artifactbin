/**
 * THE PAGE'S OWN FETCH, installed by core (build.server's entry) before any author script runs, in every mode. Every
 * fetch it does not name below goes to the browser's own fetch with the arguments it was given, untouched, so CSP,
 * CORS and credentials behave exactly as before.
 *
 * A FILE PUBLISHED WITH THE PAGE — `fetch('./data.json')` reads the file the page's publication recorded at that path.
 * `files` (the runtime config's table, lib/html-publication-bundle publishedFileTable) maps each recorded path, relative
 * to the page, to where it is read: the page's own asset door (which checks the reader on every request) or, in an
 * offline copy, its bytes. A request whose URL, resolved against the document as the browser resolves it, is one of
 * those paths on the page's own origin goes to the browser's own fetch at that address, its query and hash dropped (the
 * stored file does not vary by them) and a Request's method, headers, body and signal kept; nothing else is touched.
 *
 * A HOST THE PAGE DECLARES — `<meta name="csp-connect" content="https://api.example.com">` — is reached through the
 * page's own fetch door (app/a/[id]/fetch) on the origin that serves it: a GET to a declared origin (or one under a
 * declared `*.` wildcard) is sent to `/a/<id>/fetch?url=<that URL>` with its signal, because the document's policy
 * never lets the reader's browser connect to a declared host itself (lib/page-styles/document-csp). The door decides:
 * this reader trusts the host (they published it, or allowed it on the consent bar), GET only, no request headers or
 * credentials forwarded, 5 MB, 10 s. Any other method goes to the browser's fetch untouched. Not in the `/raw` sandbox
 * (an opaque origin), whose own policy admits the hosts the reader trusts directly.
 *
 * Framework-free and value-free imports only: it is part of every page's core.
 */

/** The page's declared connect origins (runtime config `connect`) and the id its fetch door is addressed by. */
export interface DeclaredHosts {pageId:string;origins:readonly string[]}
/** lib/document cspOriginMatches, restated so core carries no server value: exact, or a host under `https://*.`. */
const declares=(declared:string,url:URL)=>{
 if(declared===url.origin)return true;
 const wild=/^https:\/\/\*\.([^/:]+)(:\d+)?$/.exec(declared);
 return !!wild&&url.protocol==='https:'&&url.hostname.endsWith('.'+wild[1])&&(url.port?':'+url.port:'')===(wild[2]??'');
};
/** Replace `win.fetch`; returns the restore. `files`: path -> address. */
export function installPageFetch(win:Window,files?:Readonly<Record<string,string>>,hosts?:DeclaredHosts):()=>void{
 // Captured now, before the author's script can replace them.
 const scope=win as unknown as typeof globalThis;
 const native=win.fetch,apply=Reflect.apply,U=scope.URL,Req=scope.Request,location=win.location,doc=win.document;
 // A host without fetch (a test's bare window) has nothing to intercept.
 if(typeof native!=='function'||typeof Req!=='function'||typeof U!=='function')return ()=>{};
 // Resolved once: the document's base never moves (every served policy says base-uri 'none').
 const published=new Map<string,string>();
 for(const [name,address] of Object.entries(files??{}))try{const at=new U(name,doc.baseURI);published.set(at.origin+at.pathname,new U(address,doc.baseURI).href);}catch{}
 const target=(input:string|URL|Request):URL|null=>{
  try{return new U(typeof input==='string'?input:input instanceof Req?input.url:input.href,doc.baseURI);}catch{return null;}
 };
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
  // A GET to a declared host goes through the page's fetch door, where the reader's trust is checked.
  const init=args[1] as RequestInit|undefined;
  if(url&&hosts&&win.origin!=='null'&&(url.protocol==='https:'||url.protocol==='http:')&&url.origin!==new U(location.href).origin&&hosts.origins.some(origin=>declares(origin,url!))
   &&((init?.method??(input instanceof Req?input.method:'GET')).toUpperCase()==='GET')){
   const signal=init?.signal??(input instanceof Req?input.signal:undefined);
   return apply(native,win,[new U(`/a/${encodeURIComponent(hosts.pageId)}/fetch?url=${encodeURIComponent(url.href)}`,doc.baseURI).href,signal?{signal}:{}]);
  }
  return apply(native,win,[input,...args.slice(1)]);
 };
 win.fetch=fetch;
 return ()=>{if(win.fetch===fetch)win.fetch=native;};
}
