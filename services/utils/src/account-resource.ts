import type {AccountResource} from '@artifactbin/contracts';
/** The CLI's literal YAML and the server use this same finite field vocabulary. */
export function parseAccountResource(input:unknown):AccountResource{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Account resources must be mappings.');
 const value={...input} as Record<string,unknown>;
 if(typeof value.type!=='string'||!['profile','token'].includes(value.type.toLowerCase()))throw new Error('Use type: profile or token.');
 value.type=value.type.toLowerCase();
 const fields=value.type==='profile'?['type','id','state','username','email','name','liked','following']:['type','id','state','name','expires_at','expires_in','status','created_at','last_used_at'];
 for(const [key,item] of Object.entries(value)){
  if(!fields.includes(key))throw new Error(`Unknown ${value.type} field: ${key}.`);
  if(key==='type')continue;
  if(key==='liked'||key==='following'){
   const pattern=key==='liked'?/^[A-Za-z0-9]{6,12}$/:/^usr_[A-Za-z0-9_-]+$/;
   if(!Array.isArray(item)||item.length>1000||!item.every(id=>typeof id==='string'&&pattern.test(id))||new Set(item).size!==item.length)throw new Error(`${key} must contain at most 1000 distinct exact IDs.`);
  }else if(key==='id'){if(typeof item!=='string'||!(value.type==='profile'?/^usr_[A-Za-z0-9_-]+$/:/^tok_[A-Za-z0-9_-]+$/).test(item))throw new Error('Invalid account resource ID.');}
  else if(key==='state'){if(typeof item!=='string'||!/^[a-f0-9]{64}$/.test(item))throw new Error('Invalid observed state.');}
  else if(key==='expires_in'){if(!Number.isSafeInteger(item)||Number(item)<3600||Number(item)>31536000)throw new Error('expires_in must be 3600–31536000 seconds.');}
  else if(key==='status'){if(typeof item!=='string'||!['active','expired','revoked'].includes(item.toLowerCase()))throw new Error('Invalid token status.');value[key]=item.toLowerCase();}
  else if(['expires_at','created_at','last_used_at'].includes(key)){if(item!==null&&(typeof item!=='string'||!Number.isFinite(Date.parse(item))))throw new Error(`Invalid ${key} timestamp.`);}
  else if(item!==null&&(typeof item!=='string'||item.length>1000))throw new Error(`Invalid ${key}.`);
 }
 return value as unknown as AccountResource;
}
