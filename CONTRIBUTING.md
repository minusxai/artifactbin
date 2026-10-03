# Contributing

Read [AGENTS.md](AGENTS.md) first for working rules and links to subsystem design notes.

- **Test-driven, in that order**: contracts and types first, a failing test second, the implementation third, then
  the affected tests. A test that was never red is decoration.
- Run only fast checks locally: `npm run validate` and `npm test`. The budget, what exit 2 means,
  the reuse receipts and which suites are CI-only are stated once, in [AGENTS.md](AGENTS.md).
- Keep modules deep: a feature's complexity lives in one `lib/` module with a narrow interface; route handlers
  only translate results into HTTP. Use the owning service’s config module; preserve documented lazy browser imports.
- Open pull requests against `main`. Small, focused PRs land fastest.

## The dev flow

Run `npm run setup` before `npm run dev`. It safely edits an existing `.env` and
keeps current values when you press Enter; `npm run setup -- --yes` creates or
repairs it with defaults without asking questions.

Two ways to run the app in development, mirroring the two deployment shapes:

- **`npm run dev`** — the whole product in one process: shared human login and
  OAuth composed with the app, SQL engine and export browser. This is what
  browser gates expect and the default for user-visible work.
- **`npm run dev:app`** — the app alone (`server.ts --app-only`), without login
  or OAuth routes. Use it when working on the app without authentication, or
  behind a separately composed host. SQL and browser engines remain local;
  inherited remote service URLs are unset for this child with a diagnostic.

OSS contains no proxy or request-rate policy. Production composes its own
proxy around the same application and shared authentication modules.

For local login, request a code in the browser, then read it with
`npm run dev:otp -- your@email.example`. To use this checkout's CLI, run
`npm run afbin -- auth`, approve it in the same browser, then use
`npm run afbin -- <command>`. Its credentials live in `~/.artifactbin-dev/<port>`.
[OSS feature setup](docs/oss-onboarding.md) covers a first document and the
additional prerequisites for exports, live sessions, lambdas and remote agents.

Both derive the port the same way (`APP__PORT`, else the port in
`APP__PUBLIC_BASE_URL`, else 3030) and prebuild the shared islands before
booting. One process per port per data dir: PGLite (the default dev database)
may be owned by exactly one process, so a second checkout changes its port in
`.env` rather than sharing the dir.

### Documents on their own origins (`APP__PAGES_HOST`, required)

Every document is served at `<hex(id)>.<pages host>` and the app page frames it (services/app/server/pages-host.ts,
services/app/lib/serving/document-frame.ts); there is no other renderer, so the server refuses to boot without
`APP__PAGES_HOST`. The frame reads its reader from an `afbin_pages` cookie that is `SameSite=Lax`, so the app and the
pages host must be the **same site**. In development that means browsing the app at a name under the pages host, not
at `localhost` — which is what `npm run setup` writes by default:

```sh
npm run setup -- --yes                   # APP__PAGES_HOST=lvh.me, APP__PUBLIC_BASE_URL=http://app.lvh.me:<port>
npm run dev                              # then open http://app.lvh.me:<port>
```

`lvh.me` and every name under it resolve to 127.0.0.1 in public DNS, so no hosts-file edit is needed;
the login outbox and the CLI's device mint treat them as loopback. `npm run setup -- --pages-host <host>`
names another host (production: a subdomain of the app's registrable domain, such as `pages.example.com`). The dev
server tells Vite `allowedHosts: ['.<pages host>', <app host>]` (its DNS-rebinding guard refuses unknown `Host`s, and
every document is a new one) and `cors: false` (the app's origin gate, not Vite, answers CORS). The browser proof is
`node scripts/gates/gate-own-origin-script.mjs <base>`; the gate runner's own servers use `pages.localhost`, and the gates
that need the pages cookie boot their own server at `app.lvh.me` from `dist/server.mjs`.
