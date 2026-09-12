/**
 * One open store per private state directory, for the life of the process.
 *
 * A single command reads and writes the store from many modules — tracking,
 * staged files, pending requests, conflicts — and every writer that must commit
 * together needs the same connection for `State.transaction` to mean anything.
 * Reopening SQLite per call would also cost more than the work it guards. This
 * module hides that sharing behind one function; nothing else caches a handle.
 */
import {configDir} from './config';
import {State} from './state';

const stores = new Map<string, Promise<State>>();

export function stateFor(home: string, env: NodeJS.ProcessEnv = process.env): Promise<State> {
  const key = configDir(home, env);
  let opened = stores.get(key);
  if (!opened) { opened = State.open(home, env); stores.set(key, opened); }
  return opened;
}

/** Release the cached handles. Tests that assert on-disk state use this; commands exit instead. */
export async function closeStores(): Promise<void> {
  const opened = [...stores.values()];
  stores.clear();
  for (const store of opened) (await store).close();
}
