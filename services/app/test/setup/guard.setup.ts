// The pr fast guard tier (vitest.guard.config.ts) keeps the full suite's cwd contract (vitest.setup.ts): the app's cwd
// is its package dir, because the skill tree and other modules resolve files from process.cwd().
process.chdir(process.env.APP_PACKAGE_ROOT!);
// And its database seam: a guard file that boots the app harness (agent-starter-consistency) gets an
// in-memory PGLite. Without it the harness opened the implicit store, services/app/data/pglite, which `npm run dev`
// holds open in the same checkout, and wiped its tables under the running server. Imported after the chdir, as there.
await import('./database');
// Nothing else of that setup (services, object store).
export {};
