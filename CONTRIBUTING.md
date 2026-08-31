# Contributing

Read `CLAUDE.md` first — it is the project's design record, and every rule in it was learned by breaking it.

- **Test-driven, in that order**: contracts and types first, a failing test second, the implementation third, then
  the full suite. A test that was never red is decoration.
- `npm run validate` type-checks; `npm test` runs the API suite against in-memory PGLite; `npm run test:gates`
  drives the browser gates against a running dev server (`npm run dev`).
- Keep modules deep: a feature's complexity lives in one `lib/` module with a narrow interface; route handlers
  only translate results into HTTP. No `process.env` outside `lib/config.ts`; no inline imports.
- Open pull requests against `main`. Small, focused PRs land fastest.

## The dev flow

Run `npm run setup` before `npm run dev` (`npm run setup -- --yes` accepts the defaults).

Two ways to run the app in development, mirroring the two deployment shapes:

- **`npm run dev`** — the whole product in one process: the proxy (human login,
  OAuth, the rate-limit doors) composed in-process in front of the app, with
  the SQL engine and the export browser in the same process. This is what the
  browser gates expect, and the default for working on anything user-visible.
- **`npm run dev:app`** — the app alone (`server.ts --app-only`, one entry, one
  flag): no proxy composition, so the proxy's routes (`/api/auth/sign-in/email`,
  `/oauth/authorize`) answer 404 — that absence is the point, not a bug. Use it
  when the proxy runs beside you as its own process (point it at your port
  with `APP__UPSTREAM_URL`), or when you don't need login/OAuth. Its contract
  is LOCAL sql and browser: a `SQL__SERVICE_URL`/`BROWSER__SERVICE_URL` your
  `.env` carries for the split shape is unset for the child, with one line
  saying so — without that, every document query dies against a URL nothing
  is serving, with nothing telling you why.

Both derive the port the same way (`APP__PORT`, else the port in
`APP__PUBLIC_BASE_URL`, else 3030) and prebuild the story runtime before
booting. One process per port per data dir: PGLite (the default dev database)
may be owned by exactly one process, so a second checkout changes its port in
`.env` rather than sharing the dir.
