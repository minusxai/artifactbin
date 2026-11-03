// The pr fast guard tier (vitest.guard.config.ts) keeps the full suite's cwd contract (vitest.setup.ts): the app's cwd
// is its package dir, because the skill tree and other modules resolve files from process.cwd(). It needs nothing
// else of that setup (services, database, object store).
process.chdir(process.env.APP_PACKAGE_ROOT!);
