/** Seed gates through real reads and conditional writes. Browser traffic and explicit guards stay untouched. */
export async function observeFixtureWrite(raw,input,init={}){
 const url=new URL(String(input));
 const method=(init.method??'GET').toUpperCase();
 const revert=method==='POST'&&/^\/api\/(?:my\/)?artifacts\/[^/]+\/revert$/.test(url.pathname);
 if((!revert&&(!['PUT','PATCH'].includes(method)||!/^\/api\/(?:my\/)?artifacts\/[^/]+$/.test(url.pathname)))||typeof init.body!=='string')return raw(input,init);
 let body;try{body=JSON.parse(init.body);}catch{return raw(input,init);}
 if(!body||Array.isArray(body)||typeof body!=='object'||(body.expectedState!==undefined&&(method==='PATCH'||body.expectedVersion!==undefined)))return raw(input,init);
 const readUrl=revert?new URL(url.pathname.replace(/\/revert$/,''),url.origin).href:input;
 const observed=await raw(readUrl,{method:'GET',headers:init.headers,redirect:'error'});
 if(!observed.ok)return raw(input,init); // Permission and missing-resource checks exercise the original refusal.
 const head=await observed.json();
 return raw(input,{...init,body:JSON.stringify({...body,...(method!=='PATCH'&&body.expectedVersion===undefined?{expectedVersion:head.version}:{}),...(body.expectedState===undefined?{expectedState:head.state}:{})})});
}
export const fixtureFetch=(input,init)=>observeFixtureWrite(globalThis.fetch,input,init);
