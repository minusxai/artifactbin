import {configDir} from './config';
import {CliError} from './commands';
import {HttpClient,transportFailure} from './http';
import {ARTIFACT_APPROVAL_PATH} from '@artifactbin/contracts';
/** Browser consent and bounded polling, independent of terminal prompts and command dispatch. */
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { atomicWrite, digest, privateDirectory, readOptional } from './files';
import { loadConnection, normalizeServer, saveConnection, type Connection } from './config';
import {withLock} from './state';

interface Pending { connectionKey?: string; server: string; deviceCode: string; userCode: string; verificationUrl: string; expiresAt: number; interval: number }
interface DeviceResponse { authorized?: boolean; device_code: string; user_code: string; verification_uri_complete: string; expires_in: number; interval: number }
/** An unattended agent gives up polling for approval after this bound, failing fast with an actionable error instead of holding the full device-code window. */
const AGENT_APPROVAL_WAIT_MS = 45_000;
export class ApprovalRequired extends Error {
  readonly code = 'approval_required';
  constructor(readonly verificationUrl: string, readonly userCode: string, readonly expiresAt: number) {
    super(`Approve code ${userCode} at ${verificationUrl}, the pending command will continue after approval.`);
  }
}
export interface AuthOptions {
  home?: string;
  /** Only `ARTIFACTBIN_HOME` is read here: an explicit `ARTIFACTBIN_TOKEN` never short-circuits browser approval. */
  env?: NodeJS.ProcessEnv;
  interactive: boolean;
  /** Optional artifact: skip approval if accessible, otherwise connect to its browser owner. */
  artifactId?: string;
  connection?: Connection;
  /** A rejected token must not be reused; another process may already have replaced it. */
  rejectedToken?: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  open?: (url: string) => Promise<void>;
  notify?: (message: string) => void;
}
export async function openBrowser(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {timeout:10000}, error => error ? reject(new Error('Could not open the browser; use the displayed approval URL.')) : resolve());
  });
}
export async function browserAuthenticate(origin:string,options:AuthOptions):Promise<Connection>{
 const server=normalizeServer(origin);
 const home=options.home??homedir();
 return withLock(home,`auth:${server}`,async()=>{
  const saved=await loadConnection(server,home,{ARTIFACTBIN_HOME:configDir(home,options.env)});
  if(options.artifactId)return deviceAuthenticate(server,{...options,connection:saved??undefined});
 if(saved&&saved.token!==options.rejectedToken&&(!saved.expiresAt||saved.expiresAt>(options.now??Date.now)()))return saved;
  // The same browser approval supports guests in terminals and unattended agents.
  return deviceAuthenticate(server,options);
 },{waitMs:300000});
}
export async function deviceAuthenticate(origin: string, options: AuthOptions): Promise<Connection> {
  const server = normalizeServer(origin);
  const home = options.home ?? homedir();
  const clock = options.now ?? Date.now;
  const request = options.fetch ?? fetch;
  const file = join(configDir(home,options.env), `pairing-${digest(server).slice(0,16)}${options.artifactId ? `-${options.artifactId}` : ''}.json`);
  let connection = options.connection;
  const endpoint = options.artifactId ? ARTIFACT_APPROVAL_PATH : '/oauth/device';
  const post = async (path: string, body?: unknown) => {
    const response = await request(`${server}${path}`, {method:'POST', redirect:'error', signal:AbortSignal.timeout(15000),
      headers:{'Content-Type':'application/json', ...(connection ? {Authorization:`Bearer ${connection.token}`} : {})}, ...(body ? {body:JSON.stringify(body)} : {})}).catch(error => { throw transportFailure(server, error); });
    const data = await response.json().catch(()=>null);
    if (!data || typeof data !== 'object') throw new CliError('invalid_response','Authentication server returned an invalid response.');
    return {response,data};
  };
  let pending: Pending | undefined;
  const raw = await readOptional(file);
  if (raw) {
    const value = JSON.parse(raw.toString()) as Pending;
    if (validPending(value, server) && value.expiresAt > clock() && value.connectionKey === (connection ? digest(connection.token) : undefined)) pending = value;
  }
  if (!pending) {
    let result;
    if (options.artifactId && connection) {
      const client = new HttpClient({connection,home,env:options.env,fetch:options.fetch});
      try {
        const data = await client.request<DeviceResponse>(ARTIFACT_APPROVAL_PATH.slice(4), 'POST', {artifactId:options.artifactId});
        connection = client.connection;
        if (data.authorized === true) return connection;
        result = {response:{ok:true,status:200},data};
      } catch (error) {
        if (!(error instanceof CliError) || error.code !== 'auth_required') throw error;
        // The old connection cannot be used or refreshed. Obtain a replacement
        // and artifact access together, only after a new explicit approval.
        connection = undefined;
        result = await post(endpoint, {artifactId:options.artifactId});
      }
    } else result = await post(endpoint, options.artifactId ? {artifactId:options.artifactId} : undefined);
    const {response,data} = result;
    if (!response.ok) throw new CliError('auth_failed',`Could not start browser authentication (HTTP ${response.status}).`);
    pending = {server, ...(connection ? {connectionKey:digest(connection.token)} : {}), deviceCode:data.device_code,userCode:data.user_code,verificationUrl:data.verification_uri_complete,
      expiresAt:clock()+Math.min(300, data.expires_in)*1000,interval:Math.max(5,data.interval)*1000};
    if (!validPending(pending,server)) {
      let advertised='';try{advertised=new URL(String(data.verification_uri_complete)).origin;}catch{/* malformed */}
      if(advertised&&advertised!==server)throw new CliError('approval_origin_mismatch',`The selected server ${server} asks for approval at ${advertised}, a different origin.`,`Run the command with --server ${advertised} if that is the server you meant; credentials are never sent to an origin you did not select.`);
      throw new CliError('invalid_response','Authentication server returned invalid pairing details.');
    }
    await privateDirectory(configDir(home,options.env));
    await atomicWrite(file,JSON.stringify(pending));
  }
  const approval = new ApprovalRequired(pending.verificationUrl,pending.userCode,pending.expiresAt);
  {
    (options.notify ?? (message=>process.stderr.write(`${message}\n`)))(approval.message);
    try { await (options.open ?? openBrowser)(pending.verificationUrl); }
    catch (error) { options.notify?.(error instanceof Error ? error.message : 'Open the approval URL in your browser.'); }
  }
  const deadline = options.interactive ? pending.expiresAt : Math.min(pending.expiresAt, clock() + AGENT_APPROVAL_WAIT_MS);
  while (clock() < deadline) {
    const {response,data} = await post(`${endpoint}/token`, {device_code:pending.deviceCode});
    if (response.ok) {
      if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || typeof data.client_id !== 'string'
        || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new CliError('invalid_response','Authentication server returned invalid credentials.');
      const approvedConnection: Connection = {server,token:data.access_token,refreshToken:data.refresh_token,clientId:data.client_id,expiresAt:clock()+data.expires_in*1000};
      await saveConnection(approvedConnection,home,{ARTIFACTBIN_HOME:configDir(home,options.env)});
      await unlink(file);
      return approvedConnection;
    }
    if (data.error !== 'authorization_pending') {
      if (data.error === 'expired_token' || data.error === 'access_denied') await unlink(file);
      const code=data.error==='access_denied'?'access_denied':data.error==='expired_token'?'approval_expired':'auth_failed';
      throw new CliError(code,code==='access_denied'?'Browser approval was denied.':code==='approval_expired'?'Browser approval expired.':'Browser authentication failed.','Run afbin auth again.');
    }
    await (options.sleep ?? sleep)(Math.min(pending.interval,Math.max(0,deadline-clock())));
  }
  if (!options.interactive && clock() < pending.expiresAt) throw approval;
  await unlink(file);
  throw new CliError('approval_expired','Browser approval expired.','Run afbin auth again.');
}
function validPending(value: Pending, server: string): boolean {
  if (!value || value.server !== server || typeof value.deviceCode !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.deviceCode)
    || typeof value.userCode !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(value.userCode)
    || !Number.isFinite(value.expiresAt) || !Number.isFinite(value.interval) || value.interval < 5000 || value.interval > 300000) return false;
  try { const url = new URL(value.verificationUrl); return url.origin === server && url.pathname === '/oauth/device' && !url.username && !url.password && !url.hash; }
  catch {return false;}
}
