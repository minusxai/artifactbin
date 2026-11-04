import {isResolverDatabaseKind,type ResolverSecretHosts,type RunnerJson} from '@artifactbin/contracts';
import {databaseConnection} from '@/lib/html-backend-secrets';
import {ResolverFetchError} from './public-fetch';
/** The pinned version's bindings and a reader for the owner's stored values. */
interface ResolverConnections {hosts:ResolverSecretHosts;read(name:string):Promise<string>}
const NAME=/^[A-Z][A-Z0-9_]{0,63}$/;
/**
 * `caps.db(name)`, the host half: the owner's stored connection for a name the pinned version declares as a database
 * kind (RESOLVER_DATABASE_KINDS: `'postgres'`, `'mysql'`). Its answer, `kind` and the password included, goes to the
 * runner, which grants the run a tunnel to exactly this host and port (services/runner database-tunnel.ts) and gives
 * the settings to the worker's driver for that kind, never to resolver code. A name the page does not declare as a
 * database is `unknown_connection`; an unset or unreadable value, or one stored for another kind, is
 * `connection_unavailable`. Refusals carry only a code and the name.
 */
export async function resolverDatabaseConnection(input:RunnerJson,connections:ResolverConnections):Promise<RunnerJson>{
 const name=input&&typeof input==='object'&&!Array.isArray(input)?input.name:undefined;
 if(typeof name!=='string'||!NAME.test(name))throw new ResolverFetchError('invalid_request','connection name');
 const kind=Object.hasOwn(connections.hosts,name)?connections.hosts[name]:undefined;
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
