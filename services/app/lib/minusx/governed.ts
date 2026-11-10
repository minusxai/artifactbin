/**
 * PAGE DATA OVER A GOVERNED CONNECTION (contract §8). A page function's connection name declared `'minusx'` is bound,
 * by the page's author and server-side, to `{connection_id, group_id}` (`MinusxBinding`, stored sealed with the
 * page's other connection values, no password). Two decisions live here:
 *
 * - `validateMinusxBinding`: may this AUTHOR pin that connection to that group? The author must be a direct member
 *   of the group (lib/groups' membership read) and MinusX, asked with a delegation for the author under that group,
 *   must list the connection. Run when the binding is set and again when a page carrying it is published.
 * - `governedConnection`: the endpoint and short-lived credential a RUN connects with, obtained from MinusX
 *   (`POST /connection-sessions`) with a delegation for the run's admitted caller (the signed `RunnerCaller`
 *   subject, never the page owner, never a value resolver code supplies) under the PINNED group. A caller MinusX
 *   refuses, or no caller at all (anonymous), is `data_access_denied`; there is no fallback to anyone else's
 *   access and no direct connection. MinusX unreachable is `data_unavailable`.
 */
import {isResolverDatabaseKind,type MinusxBinding,type MinusxConnections} from '@artifactbin/contracts';
import {getGroupRole} from '@/lib/groups';
import {databaseConnection,type DatabaseConnection} from '@/lib/html-backend-secrets';
import {IS_DEV,IS_TEST,minusxSettings} from '@/lib/platform';
import {createMinusxClient,MinusxRefusal} from './client';

const ID=/^[A-Za-z0-9_.:-]{1,128}$/;
/** The validated binding, or `invalid_binding`: exactly `{connection_id, group_id}`, each a bounded id. */
export function minusxBinding(value:unknown):MinusxBinding{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_binding');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(key=>key!=='connection_id'&&key!=='group_id')||typeof v.connection_id!=='string'||!ID.test(v.connection_id)||typeof v.group_id!=='string'||!ID.test(v.group_id))throw Error('invalid_binding');
 return {connection_id:v.connection_id,group_id:v.group_id};
}

/** Why an author may not pin a binding: `minusx_not_configured`, `not_group_member`, `binding_forbidden`, `connection_not_visible`, `minusx_unavailable`. */
export class MinusxBindingError extends Error {constructor(readonly code:string){super(code);this.name='MinusxBindingError';}}
/**
 * The connections an author could pin under `groupId`: what MinusX lists for a delegation minted for that author under
 * exactly that group (the author must be a direct member of it), refused as `validateMinusxBinding` refuses.
 */
export async function minusxConnectionsFor(authorId:string,groupId:string):Promise<MinusxConnections['connections']>{
 const settings=minusxSettings();
 if(!settings)throw new MinusxBindingError('minusx_not_configured');
 // Direct membership of exactly that group: a parent's or a child's membership is not this group's.
 if(!await getGroupRole(authorId,groupId))throw new MinusxBindingError('not_group_member');
 try{return (await createMinusxClient(settings).connections({userId:authorId,groupId})).connections;}
 catch(error){throw new MinusxBindingError(error instanceof MinusxRefusal&&(error.status===401||error.status===403)?'binding_forbidden':'minusx_unavailable');}
}
export async function validateMinusxBinding(authorId:string,binding:MinusxBinding):Promise<void>{
 if(!(await minusxConnectionsFor(authorId,binding.group_id)).some(connection=>connection.id===binding.connection_id))throw new MinusxBindingError('connection_not_visible');
}

/** A run's refusal: `data_access_denied`, `connection_unavailable` or `data_unavailable`, with nothing else in it. */
export class GovernedRefusal extends Error {constructor(readonly code:'data_access_denied'|'connection_unavailable'|'data_unavailable'){super(code);this.name='GovernedRefusal';}}
const LOOPBACK=new Set(['127.0.0.1','::1','localhost']);
export async function governedConnection(input:{subject:string|null;binding:MinusxBinding;pageId:string;signal?:AbortSignal}):Promise<DatabaseConnection>{
 const settings=minusxSettings();
 if(!settings)throw new GovernedRefusal('data_unavailable');
 if(!input.subject)throw new GovernedRefusal('data_access_denied');
 let session;
 try{session=await createMinusxClient(settings).connectionSession({userId:input.subject,groupId:input.binding.group_id,pageId:input.pageId},input.binding.connection_id,input.signal);}
 catch(error){
  if(error instanceof MinusxRefusal&&(error.status===401||error.status===403))throw new GovernedRefusal('data_access_denied');
  if(error instanceof MinusxRefusal&&[404,409,422].includes(error.status))throw new GovernedRefusal('connection_unavailable');
  throw new GovernedRefusal('data_unavailable');
 }
 if(!isResolverDatabaseKind(session.protocol))throw new GovernedRefusal('connection_unavailable');
 // The session answer names no TLS mode: the gateway is verified (verify-full), except a loopback gateway in a
 // development or test process, which may be plaintext (the runner admits loopback only under its own opt-in).
 const tls=(IS_DEV||IS_TEST)&&LOOPBACK.has(session.host)?'disable':'verify-full';
 try{return databaseConnection({kind:session.protocol,host:session.host,port:session.port,database:session.database,user:session.user,password:session.password,tls});}
 catch{throw new GovernedRefusal('data_unavailable');}
}
