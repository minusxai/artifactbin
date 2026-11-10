import {createClient,gql} from './apollo/graphql-compat';
import {config,remote,onResolverChange} from './browser-reader';
import {createSql,SqlError} from './apollo/sql';
import {RemoteUnreachable} from './apollo/apollo-contracts';
export {startFrameBridge,onResolverChange,remoteReadOnly,uploadFile,watchUploadContext,bindFileUpload} from './browser-reader';
// Names live pages still call (onResolverChange's old name); isolated with their deletion rule in legacy-page-names.
export * from './legacy-page-names';
export {gql};
/** One statement over the page's dataset links as the reader (./apollo/sql): `${…}` values are always bound parameters. */
/**
 * `sql` (./apollo/sql) reaches the page SQL door through the reader's ONE request relay, the one GraphQL uses
 * (`remote.execute`, marked `operation: 'sql'`): the frame-bridge parent routes it to /api/artifacts/<page>/sql with the
 * trusted revision bound (lib/html-reader/frame-bridge parent `relayedSql`). The reader carries no SQL code at all: it
 * sits at its 20 KiB gzip budget (html-runtime build.test). No app frame relays in a downloaded copy, a local preview or
 * an owner host's own reads (the reader builds those transports from this same config), so those refuse at once.
 */
export const sql=createSql({
  run:(request)=>config.offline||config.localPreview||(config.domainReads&&window.parent===window)?Promise.reject(new SqlError('unavailable','sql runs in a page the app frames'))
   :remote.execute({...request,operation:'sql'} as never).then((reply)=>reply as never,(error:unknown)=>{throw error instanceof RemoteUnreachable?new SqlError('unavailable','sql runs in a page the app frames'):error;}),
  subscribe:(listener)=>{const subscription=onResolverChange((names,reason)=>listener(reason==='authority'?undefined:names));return()=>subscription.unsubscribe();},
});
export {SqlError} from './apollo/sql';
// The page's one local-state document is @afbin/state's (./browser-state); `gql` local fields read and write it. Loaded
// dynamically, never as a static import: a page whose core predates @afbin/state has no import-map entry for it, and a
// static import would fail to link before this module's skew guard (build.server) could reload the page.
const {statePort:state}=await import('./browser-state');
export const client=createClient({backends:()=>config.backends??[],datasets:()=>config.datasets??[],state,remote});

/** Read only for an explicit local Save action; this private document is never uploaded automatically. */
export const readViewerDocument=()=>state.read();

export type {FileUploadOptions} from './upload-contract';

export type {UploadContext} from '@artifactbin/contracts';
export type {PlatformUploadControl,FileUploadBinding} from './upload-contract';
