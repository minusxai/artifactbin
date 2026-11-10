import {isResolverDatabaseKind,MINUSX_CONNECTION_KIND,type MinusxBinding,type ResolverSecretHosts,type RunnerJson} from '@artifactbin/contracts';
import {databaseConnection,type DatabaseConnection} from '@/lib/html-backend-secrets';
import {GovernedRefusal,minusxBinding} from '@/lib/minusx';
import {ResolverFetchError} from './public-fetch';
/**
 * The pinned version's bindings and a reader for the owner's stored values; `governed` opens a `'minusx'` name's
 * connection for its stored binding as the run's admitted caller (lib/minusx `governedConnection`).
 */
interface ResolverConnections {hosts:ResolverSecretHosts;read(name:string):Promise<string>;governed?(binding:MinusxBinding):Promise<DatabaseConnection>}
const NAME=/^[A-Z][A-Z0-9_]{0,63}$/;
/**
 * `caps.db(name)`, the host half: the owner's stored connection for a name the pinned version declares as a database
 * kind (RESOLVER_DATABASE_KINDS: `'postgres'`, `'mysql'`). Its answer, `kind` and the password included, goes to the
 * runner, which grants the run a tunnel to exactly this host and port (services/runner database-tunnel.ts) and gives
 * the settings to the worker's driver for that kind, never to resolver code. A name the page does not declare as a
 * database is `unknown_connection`; an unset or unreadable value, or one stored for another kind, is
 * `connection_unavailable`. Refusals carry only a code and the name.
 *
 * A name declared `'minusx'` (combined mode) stores no login: its value is the author's `MinusxBinding`, and the
 * connection is the endpoint and short-lived credential MinusX hands out for the run's caller under the pinned group
 * (`governed`), answered with the session's protocol as `kind` so the worker's driver is chosen as for any other.
 * Its refusals are `data_access_denied` (no caller, or MinusX refused this one), `connection_unavailable` and
 * `data_unavailable`, again with only the name.
 */
export async function resolverDatabaseConnection(input:RunnerJson,connections:ResolverConnections):Promise<RunnerJson>{
 const name=input&&typeof input==='object'&&!Array.isArray(input)?input.name:undefined;
 if(typeof name!=='string'||!NAME.test(name))throw new ResolverFetchError('invalid_request','connection name');
 const kind=Object.hasOwn(connections.hosts,name)?connections.hosts[name]:undefined;
 if(kind===MINUSX_CONNECTION_KIND){
  if(!connections.governed)throw new ResolverFetchError('connection_unavailable',name);
  let binding:MinusxBinding;
  try{binding=minusxBinding(JSON.parse(await connections.read(name)));}catch{throw new ResolverFetchError('connection_unavailable',name);}
  try{return {...await connections.governed(binding)};}catch(error){throw new ResolverFetchError(error instanceof GovernedRefusal?error.code:'data_unavailable',name);}
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
