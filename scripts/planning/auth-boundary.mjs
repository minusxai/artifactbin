/** Disposable policy model. NOT imported by production. ACL/manifest are server-resolved inputs. */
export function singleCookie(header,name) {
 const values=(header??'').split(';').map(p=>p.trim()).filter(p=>p.startsWith(name+'=')).map(p=>p.slice(name.length+1));
 return values.length===1 && values[0] ? values[0] : null;
}
export function safeReturn(value,main) {
 try {const url=new URL(value,main);return url.origin===main && !url.username && !url.password ? url.href : null;} catch {return null;}
}
export function boundary(trusted) {
 const sequences=new Map();
 return ({host,origin,method,contentType,csrf,session,manifest,approved,acl,requestId})=>{
  if(host!==trusted || origin!==trusted || method!=='POST' || contentType!=='application/json') return 403;
  if(!session?.active || !csrf || csrf!==session.csrf || !acl) return 403;
  if(!manifest || !approved || approved.user!==session.user || approved.session!==session.id) return 403;
  if(['doc','revision','target','operation'].some(k=>!manifest[k] || manifest[k]!==approved[k])) return 403;
  if(!Number.isSafeInteger(requestId) || requestId<1) return 400;
  const key=session.id+':'+manifest.doc;
  if(requestId<=(sequences.get(key)??0)) return 409;
  sequences.set(key,requestId); return 200;
 };
}
