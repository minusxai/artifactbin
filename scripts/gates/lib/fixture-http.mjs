/** Gate HTTP client: observe the current head before an unguarded native HTML,
 * data or metadata replacement. Explicit stale guards are preserved so the
 * real server, rather than this helper, decides conflicts. Browser traffic is untouched. */
/** @param {typeof fetch} raw */
export async function observeFixtureWrite(raw,input,init={}){
 const url=new URL(String(input)),method=(init.method??'GET').toUpperCase();
 if(!/^\/api\/(?:my\/)?artifacts\/[^/]+$/.test(url.pathname)||!['PUT','PATCH'].includes(method)||typeof init.body!=='string')return raw(input,init);
 let body;try{body=JSON.parse(init.body);}catch{return raw(input,init);}
 if(!body||Array.isArray(body)||typeof body!=='object')return raw(input,init);
 if(body.expectedState!==undefined&&(method==='PATCH'||body.expectedVersion!==undefined))return raw(input,init);
 if(Object.keys(body).every(key=>['edit_id','expectedVersion','expectedState'].includes(key)))return raw(input,init);
 const observed=await raw(url.href,{method:'GET',headers:init.headers,redirect:'error'});
 if(!observed.ok)return observed;
 const head=await observed.json();
 return raw(input,{...init,body:JSON.stringify({...body,...(method!=='PATCH'&&body.expectedVersion===undefined?{expectedVersion:head.version}:{}),...(body.expectedState===undefined?{expectedState:head.state}:{})})});
}
export const fixtureFetch=(input,init)=>observeFixtureWrite(globalThis.fetch,input,init);
