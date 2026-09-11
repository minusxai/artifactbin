// Protocol-state prototype. Product persists this atomically and binds approval to its browser session.
import { randomBytes, createHash } from 'node:crypto';
const hash = x=>createHash('sha256').update(x).digest('hex');
export class Pairing {
 devices=new Map(); codes=new Map();
 begin(origin,now=Date.now()) {
  const deviceSecret=randomBytes(32).toString('base64url'),userCode=randomBytes(8).toString('hex');
  const row={origin,expires:now+300000,status:'pending'};
  this.devices.set(hash(deviceSecret),row); this.codes.set(userCode,row);
  return {deviceSecret,userCode,expires:row.expires};
 }
 row(map,key,now) { const r=map.get(key); if(!r)throw Error('unknown'); if(now>=r.expires)throw Error('expired'); return r; }
 approve(code,actor,now=Date.now()) {
  const r=this.row(this.codes,code,now); if(r.status!=='pending')throw Error(r.status);
  if(!actor.userId)throw Error('identity required'); if(actor.origin!==r.origin)throw Error('origin mismatch');
  r.userId=actor.userId; r.status='approved';
 }
 deny(code,now=Date.now()) { const r=this.row(this.codes,code,now); if(r.status!=='pending')throw Error(r.status); r.status='denied'; }
 poll(secret,now=Date.now()) { const r=this.row(this.devices,hash(secret),now); if(r.status==='consumed')throw Error('consumed'); if(r.status!=='approved')return {status:r.status}; r.status='consumed'; return {status:'approved',userId:r.userId,origin:r.origin}; }
}
