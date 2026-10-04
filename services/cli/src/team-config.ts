/** Explicit team hosting owns its settings and data; it never reads client profiles. */
import {readFile,realpath} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {isLocalDevelopmentHost} from '@artifactbin/contracts';
import {parseDatabaseUrl} from '../../app/lib/platform/database-url';
// The auth service owns both questions: which settings amount to a login someone could COMPLETE,
// and which origins the local outbox serves. Asking it keeps the refusals and the startup text true
// to the mailer, and keeps the provider names spelled out in exactly one module.
import {completeLoginMethods} from '../../auth/src/config';
import {usesDevOutbox} from '../../auth/src/mail';
// Only namespaces owned by the OSS host enter its process configuration.
const teamModules=new Set(['APP','AUTH','EMAIL','ADMIN','ANALYTICS','ARTIFACTS','ASSETS','BROWSER','DATASET','EVENTS','EXPORT','FILES','IMAGES','INTERNAL','PDF','QUOTA','SQL','WEB_INGEST']);
// Packaged hosts submit to a separate runner; worker/provider settings belong to that controller.
const runnerSettings=new Set(['RUNNER__SERVICE_URL','CONTRACT__ACTOR_SECRET']);
/**
 * A listen address that reaches this machine only: a local development host (`isLocalDevelopmentHost`,
 * the origin rule's), or IPv6 loopback as APP__HOST spells it, unbracketed. `usesDevOutbox` answers
 * the question for the public URL.
 */
const listensLocally=(host:string)=>host==='::1'||isLocalDevelopmentHost(host);
/**
 * Every document is served on its own origin, `<hex id>.<pages host>` (APP__PAGES_HOST, which the app
 * server refuses to boot without), and that host must be SAME SITE as the public URL: the frame's pages
 * cookie is SameSite=Lax. An operator value wins. Otherwise a loopback public URL (`usesDevOutbox`:
 * loopback or lvh.me) gets development's `lvh.me`, every name under which resolves to 127.0.0.1 — same
 * site only for an app at an lvh.me name, which is why `afbin serve` generates `http://app.lvh.me:<port>`
 * (serve-config) — and a named host gets
 * `pages.<its hostname>`, a subdomain and so same site by construction. An IP address has no subdomain
 * to derive, so it has to name one.
 */
export function teamPagesHost(publicUrl:URL,configured:string|undefined):string{
 if(configured?.trim())return configured.trim();
 const name=publicUrl.hostname.toLowerCase().replace(/\.$/,'');
 if(usesDevOutbox(publicUrl.origin))return 'lvh.me';
 if(name.startsWith('[')||/^\d+\.\d+\.\d+\.\d+$/.test(name))throw new Error(`Team APP__PUBLIC_BASE_URL ${publicUrl.origin} is an IP address, so no pages host can be derived from it: set APP__PAGES_HOST to a hostname on the same site that resolves to this server (documents are served at <id>.<that host>).`);
 return 'pages.'+name;
}
export interface TeamOverrides {directory?:string;port?:number;dbUrl?:string}
export interface TeamSettings {directory:string;host:string;port:number;origin:string;env:NodeJS.ProcessEnv}
export async function teamSettings(configFile:string,inherited:NodeJS.ProcessEnv=process.env,overrides:TeamOverrides={}):Promise<TeamSettings>{
 const file=await realpath(resolve(configFile)),directory=overrides.directory?await realpath(resolve(overrides.directory)):dirname(file);
 const operator:Record<string,string>={};
 for(const line of (await readFile(file,'utf8')).split(/\r?\n/)){
  if(!line.trim()||line.trim().startsWith('#'))continue;
  const pair=line.match(/^([A-Z][A-Z0-9_]*?)=(.*)$/);
  if(!pair)throw new Error('Invalid team settings: use NAME=value lines without shell expansion.');
  const key=pair[1]!,value=pair[2]!;
  if(key!=='DATABASE_URL'&&!runnerSettings.has(key)&&(!key.includes('__')||!teamModules.has(key.split('__')[0]!)||key.endsWith('__SERVICE_URL')||key==='APP__UPSTREAM_URL'))throw new Error('Unsupported team setting: '+key);
  operator[key]=value;
 }
 if(operator.RUNNER__SERVICE_URL){
  let runner:URL;try{runner=new URL(operator.RUNNER__SERVICE_URL);}catch{throw new Error('Runner URL must be an absolute HTTP(S) URL.');}
  if(!['http:','https:'].includes(runner.protocol)||runner.username||runner.password||runner.search||runner.hash)throw new Error('Runner URL must be an HTTP(S) URL without credentials, query or fragment.');
  if((operator.CONTRACT__ACTOR_SECRET?.length??0)<32)throw new Error('Remote runner requires CONTRACT__ACTOR_SECRET of at least 32 characters, matching the controller.');
 }
 const host=operator.APP__HOST?.trim()??'',port=overrides.port??Number(operator.APP__PORT);
 let url:URL;try{url=new URL(operator.APP__PUBLIC_BASE_URL??'');}catch{throw new Error('Team hosting requires APP__PUBLIC_BASE_URL.');}
 if(!host||!Number.isInteger(port)||port<1||port>65535)throw new Error('Team hosting requires APP__HOST and APP__PORT (1–65535).');
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Team APP__PUBLIC_BASE_URL must be an HTTP origin without credentials.');
 if((operator.AUTH__SECRET?.length??0)<32)throw new Error('Team hosting requires a persistent AUTH__SECRET of at least 32 characters.');
 // Startup refuses the combinations whose server boots and whose sign-in cannot complete. Each check
 // is disjoint from the others, so a refusal names the one thing that is wrong.
 if(!usesDevOutbox(url.origin)){
  if(url.protocol!=='https:')throw new Error(`Team APP__PUBLIC_BASE_URL ${url.origin} cannot be reached: afbin clients only connect over HTTPS, or HTTP on localhost. Put a TLS reverse proxy in front of this server and set APP__PUBLIC_BASE_URL=https://the-name-teammates-type.`);
  // NAMED is not CONFIGURED: a key without a sender, or an OIDC provider id without a client, boots a
  // server whose login page dies at the provider. `completeLoginMethods` is the auth service's answer.
  const methods=completeLoginMethods(operator);
  if(!methods.mail&&!methods.google&&!methods.oidc)throw new Error(`Team hosting at ${url.origin} has no login method teammates can complete, so they would be told a code was emailed and never receive one. Set EMAIL__RESEND_API_KEY AND EMAIL__FROM for emailed codes (the key alone leaves the sender at a default address no mail provider will send for), or AUTH__GOOGLE_CLIENT_ID with AUTH__GOOGLE_CLIENT_SECRET, or AUTH__OIDC_PROVIDER_ID with AUTH__OIDC_CLIENT_ID, AUTH__OIDC_CLIENT_SECRET and either AUTH__OIDC_DISCOVERY_URL or all of AUTH__OIDC_AUTHORIZATION_URL, AUTH__OIDC_TOKEN_URL and AUTH__OIDC_USERINFO_URL. Only a loopback public URL may use the local outbox.`);
 }else if(!listensLocally(host))
  throw new Error(`Team APP__HOST ${host} accepts connections from the network, but APP__PUBLIC_BASE_URL ${url.origin} is a loopback address teammates cannot open: approval and login must both happen at the public URL. Set APP__PUBLIC_BASE_URL to the URL teammates use.`);
 // A loopback public URL IS the listener, so `--port` moves it too (an lvh.me name resolves to 127.0.0.1).
 if(overrides.port!==undefined&&usesDevOutbox(url.origin))url.port=String(port);
 const data=join(directory,'data');
 const requested=overrides.dbUrl??operator.DATABASE_URL;
 if(requested&&!/^(pglite|postgres|postgresql):\/\//.test(requested))throw new Error('Use a pglite:// or postgres:// database URL.');
 const target=parseDatabaseUrl(requested??'pglite://'+join(data,'pglite'));
 const database=target.engine==='pg'?target.url:target.dataDir===null?'pglite://memory':'pglite://'+resolve(directory,target.dataDir);
 const base=Object.fromEntries(Object.entries(inherited).filter(([key])=>!key.includes('__')&&!key.startsWith('ARTIFACTBIN_')&&!['DATABASE_URL','S3_URL'].includes(key)));
 // A path the operator typed into `server.env` is relative to THAT file (docs/extraction/team.md), not
 // to a data directory `--dir` chose for them, and not to whatever cwd the server later chdir's into —
 // `resolveDevOutboxPath` would resolve a relative value against the process, so it leaves here absolute.
 for(const key of ['EMAIL__DEV_OUTBOX_PATH'])if(operator[key])operator[key]=resolve(dirname(file),operator[key]);
 return {directory,host,port,origin:url.origin,env:{...base,...operator,NODE_ENV:'production',
  EMAIL__DEV_OUTBOX_PATH:operator.EMAIL__DEV_OUTBOX_PATH??join(data,'outbox.jsonl'),
  APP__PORT:String(port),APP__PUBLIC_BASE_URL:url.origin,APP__PAGES_HOST:teamPagesHost(url,operator.APP__PAGES_HOST),DATABASE_URL:database,OBJECT_STORE__LOCAL_DIR:join(data,'objects'),ARTIFACTBIN_HOME:join(data,'runtime')}};
}
/**
 * What an operator has to pass on once the server is up: the origin teammates point a client at, the
 * npm setup that installs the host-specific skill, and where a login code actually arrives. A loopback public URL
 * always uses the local outbox — `mailerForRuntime` chooses on the origin alone, never on a mail key —
 * so saying "check your email" there would send the operator looking for mail that was never sent.
 * A published origin WITHOUT a mailer is the same trap with a different cause: startup allows it when
 * Google or OIDC can carry the login, so the last line names whatever sign-in actually works here.
 */
export function serverInstructions(settings:TeamSettings):string[]{
 return [
  `Prepare Node/npm if needed: ${settings.origin}/chat/ensure-node.sh (macOS/Linux), ${settings.origin}/chat/ensure-node.ps1 (Windows PowerShell).`,
  `Install agent skills for this host: npx --yes @artifactbin/cli@latest setup --server ${settings.origin}`,
  `Teammates point their client at this server:  npx --yes @artifactbin/cli@latest config set host ${settings.origin}`,
  usesDevOutbox(settings.origin)
   ?`Login codes are NOT emailed from a loopback URL: each one prints here as "[dev-mail] otp email=… code=…" and is appended to ${settings.env.EMAIL__DEV_OUTBOX_PATH}.`
   :loginDelivery(settings.env),
  // A derived pages host serves nothing until DNS and TLS cover it, so a published origin names it.
  ...(usesDevOutbox(settings.origin)?[]:[pagesDelivery(settings)]),
 ];
}
function pagesDelivery(settings:TeamSettings):string{
 const pages=settings.env.APP__PAGES_HOST!,scheme=new URL(settings.origin).protocol;
 return `Documents are served on their own origins, ${scheme}//<id>.${pages}: point DNS and a TLS certificate for ${pages} and *.${pages} at this server (APP__PAGES_HOST chooses another name on the same site).`;
}
function loginDelivery(env:NodeJS.ProcessEnv):string{
 const methods=completeLoginMethods(env);
 if(methods.mail)return 'Login codes go out through the configured mail provider (EMAIL__RESEND_API_KEY, EMAIL__FROM).';
 const names=[...(methods.google?['Google']:[]),...(methods.oidc?[`the ${methods.oidc.providerId} provider`]:[])];
 return `Teammates sign in with ${names.join(' or ')}: emailed login codes are not configured (set EMAIL__RESEND_API_KEY and EMAIL__FROM to offer them).`;
}
