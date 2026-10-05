import type {RunStart} from './runner';
/** JSON source of a program artifact. Credentials are never stored in its definition. */
export interface ProgramDefinition {
  version: 1;
  command: string[];
  compute?: RunStart['compute'];
  /** String configuration only; forbidden credential/runtime keys are rejected by the app. */
  env?: Record<string, string>;
}

const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
const text=(value:unknown,max:number,empty=false):value is string=>typeof value==='string'&&(empty||value.length>0)&&value.length<=max&&!value.includes('\0');
/** A saved definition is nonsecret argv/configuration, never executable server source. */
export function parseProgramDefinition(source:string):ProgramDefinition {
 try {
  if(new TextEncoder().encode(source).byteLength>65536)throw Error();
  const value:unknown=JSON.parse(source);
  if(!plain(value)||!keys(value,['version','command','compute','env'])||value.version!==1)throw Error();
  if(!Array.isArray(value.command)||value.command.length<1||value.command.length>128||value.command.some(arg=>!text(arg,8192)))throw Error();
  if(value.compute!==undefined){
   const c=value.compute;
   if(!plain(c)||!keys(c,['vcpu','memoryMiB','ttlSeconds','idleSeconds']))throw Error();
   if(typeof c.vcpu!=='number'||!Number.isFinite(c.vcpu)||c.vcpu<.25||c.vcpu>16)throw Error();
   if(!Number.isInteger(c.memoryMiB)||Number(c.memoryMiB)<128||Number(c.memoryMiB)>32768)throw Error();
   if(!Number.isInteger(c.ttlSeconds)||Number(c.ttlSeconds)<10||Number(c.ttlSeconds)>86400)throw Error();
   if(c.idleSeconds!==undefined&&(!Number.isInteger(c.idleSeconds)||Number(c.idleSeconds)<1||Number(c.idleSeconds)>Number(c.ttlSeconds??86400)))throw Error();
  }
  if(value.env!==undefined){
   // The invocation adapter adds ARTIFACTBIN_INPUT inside the controller's 128-key budget.
   if(!plain(value.env)||Object.keys(value.env).length>127)throw Error();
   for(const [key,item]of Object.entries(value.env)){
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||key.length>256||!text(item,8192,true)||/^(AF_|ARTIFACTBIN_|MODAL_|AWS_|GOOGLE_|CONTRACT__|LD_|XDG_|NODE_OPTIONS$|BASH_ENV$|ENV$|HOME$|PATH$|SHELL$|USER$|LOGNAME$)/.test(key))throw Error();
    if(/(?:API_KEY|(?:^|_)TOKEN|ACCESS_TOKEN|AUTH_TOKEN|REFRESH_TOKEN|BEARER_TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS?)$/i.test(key))throw Error();
   }
  }
  return value as unknown as ProgramDefinition;
 }catch{throw Error('invalid_program');}
}
