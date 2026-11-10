/**
 * WHAT OUTLIVES A TEST FILE in a shared module graph (a project with `isolate: false`): a replaced module
 * (`vi.mock`/`vi.doMock`/`vi.resetModules`) or a rewritten process environment. Both outlive the file in a worker's
 * module graph and environment, so a file that does either runs in an isolated project instead. Found by reading the
 * files, so a new mock or env write moves its file by itself (vitest.config.ts's api and islands projects, and pr fast's
 * node batch, scripts/lib/node-batch.mjs). A signed-in session is not a mock: the app harness names it (`setSession`,
 * services/app/__tests__/harness.ts) and clears it before every test and after every file.
 */
export const LEAKS_PAST_ITS_FILE = /\bvi\.(?:mock|doMock|resetModules|stubEnv)\(|process\.env(?:\.\w+|\[[^\]]+\])\s*(?:=[^=]|\?\?=)|delete process\.env/;
