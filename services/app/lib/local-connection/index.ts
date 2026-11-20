/**
 * The local connection's browser interface: the app page's broker for a downloaded copy, its read-only comment backend,
 * and the contract both sides share. The server's HTTP adapter enters through ./server; the portable runtime takes
 * ./browser alone, so its bundle carries neither the broker nor the comment backend.
 */
export { installLocalConnectionBroker, type LocalBrokerOptions, type LocalConnectionBroker } from './broker';
export { createLocalReadBackend } from './read-backend';
export { LOCAL_CHROME_CANVAS_SCHEME, LOCAL_CHROME_COLLAPSED_HEIGHT, type LinkedDocument, type LocalConnectionState, type SourceObservation } from './contracts';
export type { LocalDocumentConnection } from './browser';
