import {createClient,gql,readStateFragment} from './apollo/client';
import {createViewerState} from './viewer-state';
import type {StoreReceipt} from './apollo/apollo-contracts';
import {config,remote} from './browser-reader';
export {startFrameBridge,onBackendChange} from './browser-reader';
export {gql};
// A raw authored file may place its state block after the blocking core script.
// Read defaults only when the author first imports the client, after that block is parsed.
let initial=config.initialState;
if(!initial){try{initial=JSON.parse(document.querySelector('[data-af="state"]')?.textContent||'{}')}catch{initial={}}}
const key = `af:viewer:${config.pageId}`;
const carried = readStateFragment(location.hash);
const state = createViewerState({
  initial: carried.state ?? initial ?? {}, replaceInitial: !!carried.state,
  storage: { read: () => localStorage.getItem(key), write: (json) => localStorage.setItem(key, json) },
  observe(listener) { const changed = (event: StorageEvent) => { if (event.key === key) listener(); }; addEventListener('storage', changed); return () => removeEventListener('storage', changed); },
  ...(navigator.locks ? { lock: (work: () => Promise<StoreReceipt>) => navigator.locks.request(key, work) } : {}),
});
export const client=createClient({backends:config.backends??[],state,remote});
