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

/** A read: the shared store when one exists, else null. Reads never create local state. */
export async function readState(home: string, env: NodeJS.ProcessEnv = process.env): Promise<State | null> {
  const key = configDir(home, env);
  const opened = stores.get(key);
  if (opened) return opened;
  const present = await State.openIfPresent(home, env);
  if (present) stores.set(key, Promise.resolve(present));
  return present;
}

export function stateFor(home: string, env: NodeJS.ProcessEnv = process.env): Promise<State> {
  const key = configDir(home, env);
  let opened = stores.get(key);
  if (!opened) { opened = State.open(home, env); stores.set(key, opened); }
  return opened;
}
