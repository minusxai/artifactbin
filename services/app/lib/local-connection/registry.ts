import {LocalConnectionError,type ConnectionGrant,type ConnectionAuthority,type ConnectionRegistry,type ConnectionAdmission,type LinkedDocument} from './contracts';
export function validLinkedDocument(value:unknown):value is LinkedDocument{
 if(!value||typeof value!=='object')return false;
 const v=value as LinkedDocument;
 if(typeof v.platformOrigin!=='string'||typeof v.artifactId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(v.artifactId)||typeof v.baseRevision!=='string'||!/^[1-9]\d*$/.test(v.baseRevision)||typeof v.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(v.sourceDigest))return false;
 try{const origin=new URL(v.platformOrigin);return origin.origin===v.platformOrigin&&(origin.protocol==='https:'||(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname)));}catch{return false;}
}
function sameIdentity(a:LinkedDocument,b:LinkedDocument):boolean{return a.platformOrigin===b.platformOrigin&&a.artifactId===b.artifactId&&a.baseRevision===b.baseRevision&&a.sourceDigest===b.sourceDigest;}
/** Authority stays on the platform. A grant is fixed to one actor, source and document. */
export function createConnectionRegistry(options:ConnectionAuthority):ConnectionRegistry{
 const now=options.now??Date.now,random=options.random??(()=>crypto.randomUUID()),ttl=options.ttl??300_000,capacity=options.capacity??1000;
 const grants=new Map<string,{admission:ConnectionAdmission;expires:number}>();let pending=0;
 const sweep=()=>{for(const [key,value] of grants)if(value.expires<=now())grants.delete(key);};
 return {
  async grant(identity):Promise<ConnectionGrant>{
   if(!validLinkedDocument(identity))throw new LocalConnectionError('invalid_identity');
   sweep();if(grants.size+pending>=capacity)throw new LocalConnectionError('capacity');pending++;
   try{
    const admission=await options.inspect({...identity});
    if(!sameIdentity(admission.identity,identity))throw new LocalConnectionError('stale');
    const capability=random(),expires=now()+ttl;
    if(grants.has(capability))throw new LocalConnectionError('capacity');
    grants.set(capability,{admission:{...admission,identity:{...identity}},expires});return {capability,expires,role:admission.role,authenticated:admission.authenticated===true};
   }finally{pending--;}
  },
  async authorize(capability,artifactId){
   sweep();const entry=grants.get(capability);
   if(!entry||entry.admission.identity.artifactId!==artifactId)throw new LocalConnectionError('revoked');
   try{
    const current=await options.inspect({...entry.admission.identity},entry.admission);
    if(grants.get(capability)!==entry||entry.expires<=now()||current.actor!==entry.admission.actor)throw new LocalConnectionError('revoked');
    if(!sameIdentity(current.identity,entry.admission.identity))throw new LocalConnectionError('stale');
    return current;
   }catch(error){grants.delete(capability);throw error;}
  },
  async status(capability,artifactId){
   sweep();const entry=grants.get(capability);
   if(!entry||entry.admission.identity.artifactId!==artifactId)throw new LocalConnectionError('revoked');
   try{
    const current=await options.inspect({...entry.admission.identity},entry.admission);
    if(grants.get(capability)!==entry||entry.expires<=now()||current.actor!==entry.admission.actor||current.role!==entry.admission.role)throw new LocalConnectionError('revoked');
    const compatible=sameIdentity(current.identity,entry.admission.identity);
    if(!compatible)grants.delete(capability);else entry.expires=now()+ttl;
    return {admission:current,compatible};
   }catch(error){grants.delete(capability);throw error;}
  },
  revoke(capability){grants.delete(capability);},
 };
}
