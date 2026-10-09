import {AsyncLocalStorage} from 'node:async_hooks';
import {validVersion} from './version-order';
import { readFile } from "node:fs/promises";
import { atomicWrite, privateDirectory } from "./files";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { DEFAULT_SERVER as CONTRACT_DEFAULT_SERVER } from "@artifactbin/contracts";

import {credentialPaths,credentialOrigin,readCredentials,saveCredentials,observeCredentialAccount as observeAccount,observedCredentialAccount as observedAccount} from '@artifactbin/utils/node/credentials';

/** Where afbin talks when nothing selects a server (spelled once, in contracts). */
export const DEFAULT_SERVER = CONTRACT_DEFAULT_SERVER;
/** Client-only defaults. Reading or changing these never starts a server. */
interface ClientDefaults { host?: string; output?: "text" | "json"; updates?: boolean }

export interface Connection {
  server: string;
  token: string;
  refreshToken?: string;
  clientId?: string;
  expiresAt?: number;
}
const privateStateHomes = new AsyncLocalStorage<ReadonlyMap<string,string>>();
/** A nested, task-local private store. Never changes process environment or credentials for other homes. */
export function withPrivateStateHome<T>(home:string,directory:string,run:()=>T):T {
  const homes=new Map(privateStateHomes.getStore());homes.set(home,directory);
  return privateStateHomes.run(homes,run);
}

/** The CLI's private state directory: `~/.artifactbin`, or `ARTIFACTBIN_HOME` when set. Skills never live here. */
export function configDir(home = homedir(), env: NodeJS.ProcessEnv = process.env): string {
  return privateStateHomes.getStore()?.get(home) ?? (env.ARTIFACTBIN_HOME ? env.ARTIFACTBIN_HOME : join(home, ".artifactbin"));
}
/** The Claude config directory captured by a managed conversation and reused by explicit resume. */
export function claudeConfigDirectory(home:string,cwd:string,env:NodeJS.ProcessEnv=process.env):string {
 return resolve(cwd,env.CLAUDE_CONFIG_DIR??join(env.HOME??home,'.claude'));
}
/** Restore the caller's Claude auth namespace when it was implicit; otherwise scope to its saved directory. */
export function claudeConfigEnvironment(directory:string,explicit:boolean,env:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
 const restored={...env};
 if(explicit)restored.CLAUDE_CONFIG_DIR=resolve(directory);
 else delete restored.CLAUDE_CONFIG_DIR;
 return restored;
}
/** Credentials are kept per origin, so switching servers never re-prompts or overwrites another origin's token. */
export function hostDirectory(server:string,home=homedir(),env:NodeJS.ProcessEnv=process.env):string {
 return credentialPaths(server,configDir(home,env)).directory;
}
function normalizeHost(value: string): string {
  return normalizeServer(value);
}
export async function readClientDefaults(home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<ClientDefaults> {
  let value: ClientDefaults;
  try { value = JSON.parse(await readFile(join(configDir(home, env), 'config.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['host', 'output', 'updates'].includes(key))
    || (value.host !== undefined && typeof value.host !== 'string')
    || (value.output !== undefined && !['text', 'json'].includes(value.output))
    || (value.updates !== undefined && typeof value.updates !== 'boolean')) throw new Error('Invalid client config.json.');
  if (value.host !== undefined) value.host = normalizeHost(value.host);
  return value;
}
export async function setClientDefault(key: string, value: string, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<ClientDefaults> {
  const config = await readClientDefaults(home, env);
  if (key === 'host') config.host = normalizeHost(value);
  else if (key === 'output' && (value === 'text' || value === 'json')) config.output = value;
  else if (key === 'updates' && (value === 'true' || value === 'false')) config.updates = value === 'true';
  else throw new Error('Use host <origin>, output text|json, or updates true|false.');
  await privateDirectory(configDir(home, env));
  await atomicWrite(join(configDir(home, env), 'config.json'), JSON.stringify(config, null, 2) + '\n');
  return config;
}

export const normalizeServer=credentialOrigin;
/** Client defaults never read server settings or implicitly follow a login. */
export async function exportedServer(home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const selected = env.ARTIFACTBIN_URL ?? (await readClientDefaults(home, env)).host;
  return selected ? normalizeHost(selected) : undefined;
}
/** The installer may seed a first default; an existing explicit preference wins. */
export async function saveDefaultServer(server: string, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const normalized = normalizeHost(server);
  if (normalized === DEFAULT_SERVER || (await readClientDefaults(home, env)).host) return;
  await setClientDefault('host', normalized, home, env);
}
export async function loadConnection(
  server?: string,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Connection | null> {
  const selectedHost = server ?? await exportedServer(home, env) ?? DEFAULT_SERVER;
  const selected = normalizeServer(selectedHost);
  if (env.ARTIFACTBIN_TOKEN) {
    const explicitServer = normalizeHost(env.ARTIFACTBIN_URL ?? DEFAULT_SERVER);
    if(explicitServer!==selected)return null;
    if(remoteContext(env)&&env.ARTIFACTBIN__REMOTE_REFRESH_TOKEN&&env.ARTIFACTBIN__REMOTE_CLIENT_ID)
      return {server:selected,token:env.ARTIFACTBIN_TOKEN,refreshToken:env.ARTIFACTBIN__REMOTE_REFRESH_TOKEN,clientId:env.ARTIFACTBIN__REMOTE_CLIENT_ID};
    // Exporting this saved credential must not discard its refresh grant. An unrelated
    // explicit token still selects its own identity and never borrows another grant.
    const saved=await loadConnection(selected,home,{...env,ARTIFACTBIN_TOKEN:undefined});
    return saved?.token===env.ARTIFACTBIN_TOKEN?saved:{server:selected,token:env.ARTIFACTBIN_TOKEN};
  }
  return readCredentials(selected,configDir(home,env));
}
/**
 * CREDENTIALS READ THROUGH THE ALIAS MAPPING, never rewritten.
 *
 * One deployment answering at several names left credentials filed under whichever
 * name the person happened to use. Once the two names are verified as one server
 * (services/cli/src/server-identity), a token saved under either of them belongs to
 * the canonical origin — so it is READ from wherever it lives and reported as the
 * canonical origin's. Nothing on disk moves: the next `saveConnection` files the
 * refreshed credential under the canonical origin on its own, and a migration that
 * ran before verification would be a migration that could be wrong.
 */
export async function loadConnectionFor(
  identity: {canonical: string; aliases: readonly string[]},
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Connection | null> {
  for (const origin of [identity.canonical, ...identity.aliases]) {
    const saved = await loadConnection(origin, home, env);
    if (saved) return {...saved, server: identity.canonical};
  }
  return null;
}
export async function saveConnection(
  connection: Connection,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return saveCredentials(connection,configDir(home,env));
}

/** Automatic installation is opt-out; retain the old notice switch for existing installations. */
export function autoUpdatePolicy(env:NodeJS.ProcessEnv=process.env):{enabled:boolean;pin?:string} {
 const pin=env.CLI__VERSION_PIN;
 return {enabled:!['true','1'].includes((env.CLI__DISABLE_AUTO_UPDATES??'').toLowerCase())&&!['0','false','off'].includes((env.CLI__AUTO_UPDATE??'').toLowerCase())&&!['true','1'].includes((env.npm_config_offline??'').toLowerCase())&&!pin&&env.ARTIFACTBIN_GLOBAL!=='off'&&!remoteContext(env),...(pin?{pin:validVersion(pin)?pin:'invalid'}:{})};
}

/** Separate credential stores still update one shared installation: its lock/throttle belong to the user home. */
export function autoUpdateStateEnv(home:string,env:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
 return {...env,ARTIFACTBIN_HOME:join(home,'.artifactbin')};
}

/** Managed remote children inherit scoped proof; never serialize these values into documents or logs. */
export function remoteContext(env:NodeJS.ProcessEnv=process.env){
 const id=env.ARTIFACTBIN__REMOTE_SESSION,proof=env.ARTIFACTBIN__REMOTE_PROOF;
 return id&&proof?{id,proof}:undefined;
}
export function remoteChildEnv(id:string,proof:string,env:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv{
 return {...env,ARTIFACTBIN__REMOTE_SESSION:id,ARTIFACTBIN__REMOTE_PROOF:proof};
}
/** Harness permission defaults belong only to the managed child process. */
export function remotePermissionEnv(command:string,env:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv{
 if(basename(command).replace(/\.exe$/i,'')!=='opencode')return {...env};
 return {...env,OPENCODE_PERMISSION:env.OPENCODE_PERMISSION??'{"*":"allow"}'};
}
export function remoteWorkerEnv(directory:string,separator:string,connection:Connection,env:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv{
 return {...env,PATH:directory+separator+(env.PATH??''),ARTIFACTBIN_URL:connection.server,ARTIFACTBIN_TOKEN:connection.token,ARTIFACTBIN__REMOTE_REFRESH_TOKEN:connection.refreshToken,ARTIFACTBIN__REMOTE_CLIENT_ID:connection.clientId};
}

/** Shared native login with private per-agent CLI state; baked skills stay read-only. */
export function hostedWorkerEnv(command:string,home:string,directory:string,separator:string,connection:Connection,env:NodeJS.ProcessEnv=process.env,cwd=home):NodeJS.ProcessEnv {
 return {...remoteWorkerEnv(directory,separator,connection,env),HOME:home,PWD:cwd,ARTIFACTBIN_HOME:dirname(directory),ARTIFACTBIN_SKILLS:'off',CLI__DISABLE_AUTO_UPDATES:'1',...(command==='opencode'?{OPENCODE_DB:join(directory,'opencode.db')}:{})};
}

/** Portable workspace state never follows the machine-wide ARTIFACTBIN_HOME override. */
export function workspaceStateEnv(root: string): NodeJS.ProcessEnv {
 return {ARTIFACTBIN_HOME: join(root, ".artifactbin")};
}

/** Advisory identity, valid only for the credential that was actually verified. */
export async function observeCredentialAccount(connection:Connection,account:string,home=homedir(),env:NodeJS.ProcessEnv=process.env):Promise<void>{
 return observeAccount(connection,account,configDir(home,env));
}
export async function observedCredentialAccount(connection:Connection,home=homedir(),env:NodeJS.ProcessEnv=process.env):Promise<{account:string;observedAt:string}|null>{
 return observedAccount(connection,configDir(home,env));
}

/** Restore only this managed Artifactbin scope before importing command dispatch. */
export function restoreRemoteContext(context:{id:string;proof:string;home:string;server:string;connection?:Connection},env:NodeJS.ProcessEnv=process.env):void{
 env.ARTIFACTBIN__REMOTE_SESSION=context.id;env.ARTIFACTBIN__REMOTE_PROOF=context.proof;
 env.ARTIFACTBIN_HOME=context.home;env.ARTIFACTBIN_URL=context.server;
 if(context.connection){env.ARTIFACTBIN_TOKEN=context.connection.token;env.ARTIFACTBIN__REMOTE_REFRESH_TOKEN=context.connection.refreshToken;env.ARTIFACTBIN__REMOTE_CLIENT_ID=context.connection.clientId;}
}
