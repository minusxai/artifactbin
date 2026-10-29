/** The html-presence module's interface: what code outside lib/html-presence imports (rule 4, scripts/ci/module-graph.mjs). */
export { presenceChannel } from './channel.server';
export { PRESENCE_EVENT } from './contract';
export type {
  PresenceFrame, PresenceGeometry, PresencePaint, PresencePublication, PresenceRange, PresenceViewer, ReaderPreferences,
} from './contract';
export { publishPresence } from './publish.server';
export { createPresenceRoom } from './room';
