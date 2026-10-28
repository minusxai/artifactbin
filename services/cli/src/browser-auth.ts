import {browserCommand} from './platform';
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
import {AGENT_APPROVAL_WAIT_MS,loopbackAuthenticate} from './loopback-auth';

interface Pending { artifactId?: string; connectionKey?: string; server: string; deviceCode: string; userCode: string; verificationUrl: string; expiresAt: number; interval: number }
interface DeviceResponse { authorized?: boolean; device_code: string; user_code: string; verification_uri_complete: string; expires_in: number; interval: number }
const EMAIL_AUTH_HINT = 'On a chat or phone, or if a browser is unavailable, run afbin auth --email <email> and ask the user for the code (add --server <origin> for another server).';
export class ApprovalRequired extends Error {
  readonly code = 'approval_required';
  constructor(readonly verificationUrl: string, readonly userCode: string, readonly expiresAt: number) {
    super(`Approve code ${userCode} at ${verificationUrl}, the pending command will continue after approval. ${EMAIL_AUTH_HINT}`);
  }
}
export interface AuthOptions {
  home?: string;
  /** Only `ARTIFACTBIN_HOME` is read here: an explicit `ARTIFACTBIN_TOKEN` never short-circuits browser approval. */
  env?: NodeJS.ProcessEnv;
  interactive: boolean;
  /** Optional artifact: skip approval if accessible, otherwise connect to its browser owner. */
  artifactId?: string;
  /** Explicit email sign-in creates its own grant instead of resuming a browser pairing. */
  resume?: boolean;
  connection?: Connection;
  /**
   * Verified other addresses of the selected server (services/cli/src/server-identity).
   * One deployment may show its approval page on its canonical hostname while the command
   * selected another of its names; that is the same server saying so about itself, not a
   * redirection to a stranger. Credentials still travel to the SELECTED origin alone.
   */
  aliases?: readonly string[];
  /** Ignore any saved token and run a new browser approval (afbin auth --force). */
  fresh?: boolean;
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
    const command=browserCommand(url);
    execFile(command.file, command.args, {timeout:10000}, error => error ? reject(new Error('Could not open the browser; use the displayed approval URL.')) : resolve());
  });
}
export async function browserAuthenticate(origin:string,options:AuthOptions):Promise<Connection>{
 const server=normalizeServer(origin);
 const home=options.home??homedir();
 return withLock(home,`auth:${server}`,async()=>{
  const saved=await loadConnection(server,home,{ARTIFACTBIN_HOME:configDir(home,options.env)});
  // Artifact consent proves the OWNING browser may connect this artifact and replaces the saved
  // connection: that decision stays an explicit click on the device page.
  if(options.artifactId)return deviceAuthenticate(server,{...options,connection:saved??undefined});
 if(saved&&!options.fresh&&saved.token!==options.rejectedToken&&(!saved.expiresAt||saved.expiresAt>(options.now??Date.now)()))return saved;
  // A browser on this machine that is already signed in connects with no click (loopback + PKCE).
  // A kept pairing is collected first: it may already be approved on another device.
  const pairingFile=join(configDir(home,options.env),`pairing-${digest(server).slice(0,16)}.json`);
  if(options.fresh||!await keptPairing(pairingFile,server,options.now??Date.now)){
   const connection=await loopbackAuthenticate(server,{home,env:options.env,interactive:options.interactive,aliases:options.aliases,fetch:options.fetch,now:options.now,sleep:options.sleep,
    open:options.open??openBrowser,notify:options.notify??(message=>process.stderr.write(`${message}\n`))});
   if(connection){await unlink(pairingFile).catch(()=>{});return connection;}
  }
  // Remote, headless or unanswered: the device page, approved on any device.
  return deviceAuthenticate(server,options);
 },{waitMs:300000});
}
export async function deviceAuthenticate(origin: string, options: AuthOptions): Promise<Connection> {
  const server = normalizeServer(origin);
  const home = options.home ?? homedir();
  const clock = options.now ?? Date.now;
  const request = options.fetch ?? fetch;
  // Browser consent connects a server identity, not one page. A later command must
  // collect that consent before asking for another, even if it names a different page.
  const sharedFile = join(configDir(home,options.env), `pairing-${digest(server).slice(0,16)}.json`);
  let file=sharedFile;
  let connection = options.connection;
  let endpoint = options.artifactId ? ARTIFACT_APPROVAL_PATH : '/oauth/device';
  const post = async (path: string, body?: unknown) => {
    const response = await request(`${server}${path}`, {method:'POST', redirect:'error', signal:AbortSignal.timeout(15000),
      headers:{'Content-Type':'application/json', ...(connection ? {Authorization:`Bearer ${connection.token}`} : {})}, ...(body ? {body:JSON.stringify(body)} : {})}).catch(error => { throw transportFailure(server, error); });
    const data = await response.json().catch(()=>null);
    if (!data || typeof data !== 'object') throw new CliError('invalid_response','Authentication server returned an invalid response.');
    return {response,data};
  };
  let pending: Pending | undefined;
  let raw = options.resume === false || options.fresh ? null : await readOptional(file);
  // Collect approvals left by older CLIs when retrying their original artifact.
  if(!raw&&options.resume!==false&&!options.fresh&&options.artifactId){
    const legacy=sharedFile.replace(/\.json$/,`-${options.artifactId}.json`);
    raw=await readOptional(legacy);if(raw)file=legacy;
  }
  if (raw) {
    const value = JSON.parse(raw.toString()) as Pending;
    if(file!==sharedFile)value.artifactId=options.artifactId;
    if (validPending(value, server, [server, ...(options.aliases ?? [])]) && value.expiresAt > clock() && value.connectionKey === (connection ? digest(connection.token) : undefined)) {
      pending = value;
      endpoint=value.artifactId?ARTIFACT_APPROVAL_PATH:'/oauth/device';
    }
  }
  /** A kept pairing may have been approved on another device while no command was waiting. */
  const resumed = !!pending;
  // Where an approval page may live: the selected origin, and the verified other addresses of
  // the SAME server. Nothing else, and never an origin the pairing response itself named.
  const approvalOrigins = [server, ...(options.aliases ?? []).map(alias => {try{return normalizeServer(alias);}catch{return '';}}).filter(Boolean)];
  if (!pending) {
    file=sharedFile;
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
    pending = {server, ...(options.artifactId?{artifactId:options.artifactId}:{}), ...(connection ? {connectionKey:digest(connection.token)} : {}), deviceCode:data.device_code,userCode:data.user_code,verificationUrl:data.verification_uri_complete,
      expiresAt:clock()+Math.min(900, data.expires_in)*1000,interval:Math.max(5,data.interval)*1000};
    if (!validPending(pending,server,approvalOrigins)) {
      let advertised='';try{advertised=new URL(String(data.verification_uri_complete)).origin;}catch{/* malformed */}
      if(advertised&&!approvalOrigins.includes(advertised))throw new CliError('approval_origin_mismatch',`The selected server ${server} asks for approval at ${advertised}, a different origin that ${server} has not published as one of its own addresses.`,`Run the command with --server ${advertised} if that is the server you meant; credentials are never sent to an origin you did not select.`);
      throw new CliError('invalid_response','Authentication server returned invalid pairing details.');
    }
    await privateDirectory(configDir(home,options.env));
    await atomicWrite(file,JSON.stringify(pending));
  }
  const paired = pending;
  /** One approval check: the saved connection once approved, null while approval is pending. */
  const check = async (): Promise<Connection | null> => {
    const {response,data} = await post(`${endpoint}/token`, {device_code:paired.deviceCode});
    if (response.ok) {
      if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || typeof data.client_id !== 'string'
        || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new CliError('invalid_response','Authentication server returned invalid credentials.');
      const approvedConnection: Connection = {server,token:data.access_token,refreshToken:data.refresh_token,clientId:data.client_id,expiresAt:clock()+data.expires_in*1000};
      await saveConnection(approvedConnection,home,{ARTIFACTBIN_HOME:configDir(home,options.env)});
      await unlink(file);
      // Consent for a different page proves identity, never access to this page.
      // Its normal authenticated handler either confirms access or starts consent.
      if(options.artifactId&&paired.artifactId!==options.artifactId)
        return deviceAuthenticate(server,{...options,fresh:false,connection:approvedConnection});
      return approvedConnection;
    }
    if (data.error !== 'authorization_pending') {
      if (data.error === 'expired_token' || data.error === 'access_denied') await unlink(file);
      const code=data.error==='access_denied'?'access_denied':data.error==='expired_token'?'approval_expired':'auth_failed';
      throw new CliError(code,code==='access_denied'?'Browser approval was denied.':code==='approval_expired'?'Browser approval expired.':'Browser authentication failed.',code==='approval_expired'?EMAIL_AUTH_HINT:'Run afbin auth again.');
    }
    return null;
  };
  // Check a kept pairing BEFORE the browser: on a machine without one, this is how an approval
  // given on another device is ever collected.
  if (resumed) { const approved = await check(); if (approved) return approved; }
  const approval = new ApprovalRequired(pending.verificationUrl,pending.userCode,pending.expiresAt);
  {
    (options.notify ?? (message=>process.stderr.write(`${message}\n`)))(approval.message);
    try { await (options.open ?? openBrowser)(pending.verificationUrl); }
    catch (error) {
      if(error instanceof CliError)throw error;
      // The pairing stays on disk, so the promise printed above holds: a rerun collects the approval.
      throw new CliError('browser_unavailable','Could not open the browser.',`Approve code ${pending.userCode} at ${pending.verificationUrl} on any device, then rerun the command: it continues with that approval. ${EMAIL_AUTH_HINT}`);
    }
  }
  const deadline = options.interactive ? pending.expiresAt : Math.min(pending.expiresAt, clock() + AGENT_APPROVAL_WAIT_MS);
  while (clock() < deadline) {
    const approved = await check();
    if (approved) return approved;
    await (options.sleep ?? sleep)(Math.min(pending.interval,Math.max(0,deadline-clock())));
  }
  if (!options.interactive && clock() < pending.expiresAt) {
    approval.message = `Browser approval timed out. ${EMAIL_AUTH_HINT} Or approve code ${pending.userCode} at ${pending.verificationUrl} and rerun the command before the approval expires.`;
    throw approval;
  }
  await unlink(file);
  throw new CliError('approval_expired','Browser approval timed out.',EMAIL_AUTH_HINT);
}
async function keptPairing(file:string,server:string,clock:()=>number):Promise<boolean>{
 try{const raw=await readOptional(file);if(!raw)return false;const value=JSON.parse(raw.toString()) as Pending;return value.server===server&&Number.isFinite(value.expiresAt)&&value.expiresAt>clock();}
 catch{return false;}
}
function validPending(value: Pending, server: string, approvalOrigins: readonly string[] = [server]): boolean {
  if (!value || value.server !== server || typeof value.deviceCode !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.deviceCode)
    || value.artifactId!==undefined&&(typeof value.artifactId!=='string'||!/^[A-Za-z0-9]{6,12}$/.test(value.artifactId))
    || typeof value.userCode !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(value.userCode)
    || !Number.isFinite(value.expiresAt) || !Number.isFinite(value.interval) || value.interval < 5000 || value.interval > 300000) return false;
  try { const url = new URL(value.verificationUrl); return approvalOrigins.includes(url.origin) && url.pathname === '/oauth/device' && !url.username && !url.password && !url.hash; }
  catch {return false;}
}
