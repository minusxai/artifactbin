/**
 * A FILE IN A SHARED MODULE GRAPH LEAVES THE BUILTINS AS IT FOUND THEM (pr fast's node batch, vitest.node-batch.config.ts).
 * A module that adds or removes a key on a builtin prototype or namespace does it once per worker, for every later file
 * on that worker: vega-lite's `Set.prototype.toJSON` turned every later JSON-encoded Set into a string. After each file
 * this compares the builtins' own keys with what the worker started with and fails the file that changed them, naming
 * the key, so it moves to scripts/lib/node-batch.mjs NODE_BATCH_EXCLUDED (the full suite's isolated `node` project still
 * runs it) instead of breaking whichever file happens to run after it.
 */
import { afterAll, expect } from 'vitest';

const BUILTINS: Record<string, object> = {
  Object: Object.prototype, Array: Array.prototype, Set: Set.prototype, Map: Map.prototype, String: String.prototype,
  Number: Number.prototype, Boolean: Boolean.prototype, Symbol: Symbol.prototype, Promise: Promise.prototype,
  Function: Function.prototype, Date: Date.prototype, RegExp: RegExp.prototype, Error: Error.prototype, JSON, Math, Reflect,
};
const keys = (target: object) => Reflect.ownKeys(target).map(String).sort();

declare global {
  // eslint-disable-next-line no-var
  var __artifact_bin_builtin_keys__: Record<string, string[]> | undefined;
}
const start = (globalThis.__artifact_bin_builtin_keys__ ??= Object.fromEntries(Object.entries(BUILTINS).map(([name, target]) => [name, keys(target)])));

afterAll(() => {
  const changed = Object.entries(BUILTINS).flatMap(([name, target]) => {
    const now = keys(target), before = start[name]!;
    return [...now.filter((key) => !before.includes(key)).map((key) => `${name}: added ${key}`), ...before.filter((key) => !now.includes(key)).map((key) => `${name}: removed ${key}`)];
  });
  expect(changed, `${expect.getState().testPath} changed a builtin for every later file in this shared graph: list it in scripts/lib/node-batch.mjs NODE_BATCH_EXCLUDED`).toEqual([]);
});
