/**
 * `@afbin/state` (/af/state.js): `import {state} from '@afbin/state'` is a Zustand vanilla store for this viewer's
 * saved page state (./state-store, ./page-state). It owns the page's one local-state document: `@afbin/apollo` imports
 * this module for its StatePort (the build marks `./browser-state` external, as `@afbin/state`), so `gql` local fields
 * and `state` are the same values. Loaded only when a page (or `@afbin/apollo`) imports it; never part of the reader.
 */
import type { StoreReceipt } from './apollo/apollo-contracts';
import { config, remote } from './browser-reader';
import { createPageRoute, pageSeat, type PageSeat } from './page-route';
import { createPageState } from './page-state';
import { STATE_VERSION_ATTRIBUTE, isStateVersion } from '../../../contracts/src/state-version';

// A raw authored file may place its state block after the blocking core script: read it when this module first runs.
const block = document.querySelector('[data-af="state"]');
let initial = config.initialState;
if (!initial) { try { initial = JSON.parse(block?.textContent || '{}'); } catch { initial = {}; } }
const version = block?.getAttribute(STATE_VERSION_ATTRIBUTE) ?? null;
const page = createPageState({
  pageId: config.pageId, revision: config.revision ?? null, initial: initial ?? {}, version: version !== null && isStateVersion(version) ? version : null, hash: location.hash, backends: config.backends ?? [], stateBlock: block, owner: document,
  storage: { getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
  onHash(listener) { const changed = () => listener(location.hash); addEventListener('hashchange', changed); return () => removeEventListener('hashchange', changed); },
  onStorage(listener) { const changed = (event: StorageEvent) => listener(event.key); addEventListener('storage', changed); return () => removeEventListener('storage', changed); },
  ...(navigator.locks ? { lock: (name: string, work: () => Promise<StoreReceipt>) => Promise.resolve(navigator.locks.request(name, work)) } : {}),
});

/** This viewer's saved page state, as a Zustand vanilla store: getState, setState(partial | fn), subscribe. */
export const state = page.state;
/** Platform-internal: the same document as a StatePort, for `@afbin/apollo`'s client. */
export const statePort = page.port;

/** Where this copy of the page runs and what its data doors can do now (./page-route). */
export const seat = (): PageSeat => pageSeat(globalThis as unknown as Window, { ...config, online: () => remote.online() });
/** The page's screen in its address's `$` values: get, set (replace or push), subscribe (Back/Forward too), href. */
export const route = createPageRoute(globalThis as unknown as Window, config);
