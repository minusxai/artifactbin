import {SHARE_ROLES,type ShareEntry,type ShareRole} from '@artifactbin/contracts';

/** One typed sharing grammar for local YAML and server writes; no legacy bare email form. */
export function parseSharingEntries(value:unknown):ShareEntry[]|undefined{
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||value.length>100)throw new Error('shares must be a list of at most 100 email/role entries');
 const entries=new Map<string,ShareRole>();
 for(const raw of value){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!['email','role'].includes(key)))throw new Error('Each share must contain email and role');
  const email=typeof raw.email==='string'?raw.email.trim().toLowerCase():'';
  const role=typeof raw.role==='string'?raw.role.replace(/[A-Z]/g,(letter:string)=>letter.toLowerCase()):'';
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw new Error('Invalid share email');
  if(!SHARE_ROLES.includes(role as ShareRole))throw new Error(`Share role must be ${SHARE_ROLES.join(', ')}`);
  if(entries.has(email)&&entries.get(email)!==role)throw new Error('Conflicting roles for the same share email');
  entries.set(email,role as ShareRole);
 }
 return [...entries].sort(([a],[b])=>a.localeCompare(b)).map(([email,role])=>({email,role}));
}
