/**
 * THE AUTHOR REALM'S BUDGETS. The interpreter bounds its own time (an interrupt per entry) and the
 * wasm memory it is given bounds its heap; everything a host call does on the page is bounded here,
 * because an interrupt cannot fire inside a host call. Measured in the planning spike
 * (spikes/quickjs-realm on split-js-realm): a realm boots in under half a millisecond, an interrupt
 * returns within 2 ms of its deadline, the library's own memory limit is per allocation rather than a
 * total, and a `WebAssembly.Memory` maximum is the one hard cap.
 */
export const AUTHOR_REALM_LIMITS = Object.freeze({
  /** 64 KiB wasm pages: 16 MB to start, 64 MB at most, per realm, returned when the realm is dropped. */
  memoryInitialPages: 256,
  memoryMaximumPages: 1024,
  /** The library's soft limit (refuses one allocation above it); the memory maximum is the real cap. */
  softMemoryBytes: 48 << 20,
  /** Above ~320 KB the browser's own stack overflows inside the interpreter first (spike R3). */
  stackBytes: 256 * 1024,
  /** The script body's first run, and every later entry (an event, a snapshot, a settled promise). */
  startBudgetMs: 500,
  entryBudgetMs: 100,
  /** Promise jobs run per pump. */
  jobsPerPump: 1000,
  /** Host → realm → host nesting; the browser's stack bounds it otherwise, which the interpreter cannot see. */
  nestingDepth: 32,
  /** Elements a realm may create, listeners it may hold, host calls it may have in flight, subscriptions. */
  nodes: 2000,
  listeners: 500,
  pendingHostCalls: 256,
  subscriptions: 128,
  timers: 256,
  timerMaxMs: 60_000,
  /** Text a realm may read or write in one call, a selector's length, a host call's argument size. */
  textChars: 65_536,
  selectorChars: 512,
  argumentChars: 1 << 20,
  queryAllResults: 1000,
});
