/** Server HTTP adapter; browser imports use browser.ts and broker.ts. */
export {grantLocalConnection,revokeLocalConnection,observeLocalSource,localConnectionStatus} from './server';
export type { LocalDocumentConnection } from './browser';
export type { LinkedDocument, LocalConnectionState, SourceObservation } from './contracts';
