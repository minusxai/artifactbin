import {config,remote,onResolverChange} from './browser-reader';
import {createSql,SqlError} from './apollo/sql';
import {SQL_WRITE_ACCESS_LIMIT,type SqlWriteAccessRequest,type SqlWriteAccess,type SqlWriteAccessStatus} from '@artifactbin/contracts/sql';
import {SQL_FAILURES} from '@artifactbin/contracts/sql-failures';
import {RemoteUnreachable} from './apollo/apollo-contracts';
import {offlineSqlNoData} from './portable-chrome-contract';
import {createDomainSql} from './domain-reads';
export {startFrameBridge,onResolverChange,remoteReadOnly,uploadFile,watchUploadContext,bindFileUpload} from './browser-reader';
/** One statement over the page's dataset links as the reader (./apollo/sql): `${…}` values are always bound parameters. */
/**
 * `sql` (./apollo/sql) reaches the page SQL door through the reader's ONE request relay, `remote.execute`: the frame-bridge parent routes it to /api/artifacts/<page>/sql with the
 * trusted revision bound (lib/html-reader/frame-bridge parent `relayedSql`). The reader carries no SQL code at all: it
 * sits at its 20 KiB gzip budget (html-runtime build.test). No app frame relays in a local preview, so it refuses at
 * once; an unframed page (an export capture, an owner host) sends it straight to the SQL door, which selects anonymous reads on a verified
 * owner host or requires the capture's export key on the canonical host (./domain-reads `createDomainSql`). A downloaded copy
 * answers from the rows it carries, in the engine only an export embeds (`@afbin/offline-sql`, ./offline-sql), never
 * through the app, even when the copy is connected: without that module (no data in the copy) it refuses, and says so
 * where the reader sees it (offlineSqlNoData).
 */
const offlineSql=(request:{sql?:string;query?:string;params:Record<string,string|number|boolean|null>})=>{
  // A declared query reads a live dataset, whose rows no copy carries.
  if(request.query!==undefined)return Promise.reject(new SqlError('unavailable','a declared query reads a live dataset, which an offline copy does not carry'));
  const name='@afbin/offline-sql';
  return (import(name) as Promise<typeof import('./offline-sql')>).then((engine)=>engine.runOfflineSql({sql:request.sql??'',params:request.params}),offlineSqlNoData);
};
/**
 * A draft's `sql` (lib/page-drafts): its own files' tables answer here (./offline-sql); a statement naming one of its
 * `default:` links is relayed to the parent, which runs it on the install's connection as the reader, only when the
 * embedding app allowed live reads for this mount (`config.draftLive`).
 */
const namesLink=(text:string,name:string)=>new RegExp(`(^|[^\\w$."])${name}\\s*\\.`,'i').test(text);
const draftSql=(request:{sql?:string;query?:string;params:Record<string,string|number|boolean|null>})=>{
  const live=(config.draftConnections??[]).find((name)=>namesLink(request.sql??'',name));
  if(!live)return offlineSql(request);
  if(!config.draftLive)return Promise.reject(new SqlError('consent_required',SQL_FAILURES.consent_required.notice,`${live} reads live data, which this draft may read only once the reader allows it in the app showing it`));
  return remote.execute(request).then((reply)=>reply as never,(error:unknown)=>{throw error instanceof RemoteUnreachable?new SqlError('unavailable','live data is read through the app showing this draft'):error;});
};
export const sql=Object.assign(createSql({
  run:(request)=>config.localPreview?Promise.reject(new SqlError('unavailable','sql runs in a page the app frames'))
   :config.draft?draftSql(request) as never
   :config.offline?offlineSql(request) as never
   :(config.domainReads&&window.parent===window?createDomainSql(config,location,fetch.bind(window))(request):remote.execute(request)).then((reply)=>reply as never,(error:unknown)=>{throw error instanceof RemoteUnreachable?new SqlError('unavailable','sql runs in a page the app frames'):error;}),
  subscribe:(listener)=>{const subscription=onResolverChange((names,reason)=>listener(reason==='authority'?undefined:names));return()=>subscription.unsubscribe();},
}),{writeAccess:async (link:string, request:Omit<SqlWriteAccessRequest,'link'>={}):Promise<SqlWriteAccess>=>{
  const ids=request.ids??[];
  if(ids.length>SQL_WRITE_ACCESS_LIMIT)throw new TypeError(`writeAccess takes at most ${SQL_WRITE_ACCESS_LIMIT} row IDs`);
  const denied:SqlWriteAccess={insert:'denied',rows:ids.map(()=>({update:'denied',delete:false}))};
  if(config.localPreview||config.draft||config.offline||!remote.online())return denied;
  const reply=await remote.execute({params:{},writeAccess:{...request,link}}).catch(()=>null) as {writeAccess?:SqlWriteAccess}|null;
  const hints=reply?.writeAccess;
  const status=(value:unknown):value is SqlWriteAccessStatus=>value==='denied'||value==='allowed'||value==='conditional';
  if(!hints||!status(hints.insert)||!Array.isArray(hints.rows)||hints.rows.length!==ids.length||
    !hints.rows.every(row=>row&&status(row.update)&&typeof row.delete==='boolean'))return denied;
  return hints;
}});
export {SqlError} from './apollo/sql';
// The page's one local-state document is @afbin/state's (./browser-state). Loaded
// dynamically, never as a static import: a page whose core predates @afbin/state has no import-map entry for it, and a
// static import would fail to link before this module's skew guard (build.server) could reload the page.
const {statePort:state}=await import('./browser-state');

/** Read only for an explicit local Save action; this private document is never uploaded automatically. */
export const readViewerDocument=()=>state.read();

export type {FileUploadOptions} from './upload-contract';

export type {UploadContext} from '@artifactbin/contracts/dataset-upload';
export type {PlatformUploadControl,FileUploadBinding} from './upload-contract';
