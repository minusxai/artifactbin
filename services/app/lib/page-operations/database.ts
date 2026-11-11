import {isResolverDatabaseKind,parseViewerBinding,VIEWER_CONNECTION_KIND,type ResolverSecretHosts,type RunnerJson,type ViewerBinding} from '@artifactbin/contracts';
import {databaseConnection,type DatabaseConnection} from '@/lib/html-backend-secrets';
import {ViewerRefusal} from '@/lib/data-services';
import {ResolverFetchError} from './public-fetch';
/**
 * The pinned version's bindings and a reader for the owner's stored values; `viewer` opens a `'viewer'` name's
 * connection for its stored binding as the run's admitted caller (lib/data-services `viewerConnection`).
 */
interface ResolverConnections {hosts:ResolverSecretHosts;read(name:string):Promise<string>;viewer?(binding:ViewerBinding):Promise<DatabaseConnection>}
const NAME=/^[A-Z][A-Z0-9_]{0,63}$/;
/**
 * `caps.db(name)`, the host half: the owner's stored connection for a name the pinned version declares as a database
 * kind (RESOLVER_DATABASE_KINDS: `'postgres'`, `'mysql'`). Its answer, `kind` and the password included, goes to the
 * runner, which grants the run a tunnel to exactly this host and port (services/runner database-tunnel.ts) and gives
 * the settings to the worker's driver for that kind, never to resolver code. A name the page does not declare as a
 * database is `unknown_connection`; an unset or unreadable value, or one stored for another kind, is
 * `connection_unavailable`. Refusals carry only a code and the name.
 *
 * A name declared `'viewer'` stores no login: its value is the author's `ViewerBinding`, and the connection is the
 * endpoint and short-lived credential the bound data service hands out for the run's caller (`viewer`), answered with
 * the session's protocol as `kind` so the worker's driver is chosen as for any other. Its refusals are
 * `data_access_denied` (no caller, or the service refused this one), `connection_unavailable` (no readable binding)
 * and `data_unavailable`, again with only the name.
 */
export async function resolverDatabaseConnection(input:RunnerJson,connections:ResolverConnections):Promise<RunnerJson>{
 const name=input&&typeof input==='object'&&!Array.isArray(input)?input.name:undefined;
 if(typeof name!=='string'||!NAME.test(name))throw new ResolverFetchError('invalid_request','connection name');
 const kind=Object.hasOwn(connections.hosts,name)?connections.hosts[name]:undefined;
 if(kind===VIEWER_CONNECTION_KIND){
  if(!connections.viewer)throw new ResolverFetchError('connection_unavailable',name);
  let binding:ViewerBinding;
  try{binding=parseViewerBinding(JSON.parse(await connections.read(name)));}catch{throw new ResolverFetchError('connection_unavailable',name);}
  try{return {...await connections.viewer(binding)};}catch(error){throw new ResolverFetchError(error instanceof ViewerRefusal?error.code:'data_unavailable',name);}
 }
 if(!isResolverDatabaseKind(kind))throw new ResolverFetchError('unknown_connection',name);
 let stored:string;
 try{stored=await connections.read(name);}catch{throw new ResolverFetchError('connection_unavailable',name);}
 let connection;
 try{connection=databaseConnection(JSON.parse(stored));}catch{throw new ResolverFetchError('connection_unavailable',name);}
 if(connection.kind!==kind)throw new ResolverFetchError('connection_unavailable',name);
 return {...connection};
}
/** The secret part of a stored connection value (its password), for redaction; null when the value is not a connection. */
export function connectionPassword(stored:string):string|null{
 try{return databaseConnection(JSON.parse(stored)).password;}catch{return null;}
}
