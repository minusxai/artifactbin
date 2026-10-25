/** Match the existing offline-file gate's HTTPS-equivalent QA setup, without a
 * wildcard, production origin, credential, or injected Web Crypto implementation.
 * @param {string} base
 * @param {readonly string[]} pageIds Actual prepared-store reader IDs, including remaps.
 * @returns {import('./native-migration-browser-context-contract').NativeMigrationBrowserContext} */
export function nativeMigrationBrowserContext(base,pageIds){
 let url;try{url=new URL(base);}catch{throw Error('native_browser_local_origin');}
 if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]','app.lvh.me','lvh.me'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('native_browser_local_origin');
 if(!Array.isArray(pageIds)||pageIds.some(id=>typeof id!=='string'||!/^[-_A-Za-z0-9]{1,31}$/.test(id)))throw Error('native_browser_reader_id');
 const readers=[...new Set(pageIds)].map(id=>`${url.protocol}//${Buffer.from(id,'utf8').toString('hex')}.lvh.me${url.port?':'+url.port:''}`).sort();
 const origins=[url.origin,...readers];
 return {policy:'exact-local-trustworthy-origins-v1',origins,args:url.protocol==='http:'?['--unsafely-treat-insecure-origin-as-secure='+origins.join(',')]:[]};
}
