# Run your own Artifactbin

Every setting is named and explained in `.env.example`; this file covers only what you have to do.

## On your machine

Requires Node.js 22+ and npm. Nothing else: the defaults are embedded PGLite (`data/pglite`), objects on local
disk, email-code login without a mail provider, SQLite queries and local exports.

```sh
npm ci
npm run setup -- --yes     # writes .env; rerun to repair it, existing values and secrets are kept
npm run dev                # then open the public URL setup printed, http://app.lvh.me:3030 by default
```

`npm run setup` without `--yes` edits an existing `.env` interactively, keeping each current value when you
press Enter. `npm run dev` runs the whole product in one process: login and OAuth, the app, the SQL engine and the
export browser.
`npm run dev:app` runs the app alone, without login or OAuth routes.

**Use the exact URL setup printed.** Every document is served on its own origin, `<hex id>.<pages host>`, framed
by the app page, so the server refuses to boot without `APP__PAGES_HOST`. Over plain http the reader's
document cookie is `SameSite=Lax`, so the app must be on the same site as the documents: setup writes
`APP__PAGES_HOST=lvh.me` and `APP__PUBLIC_BASE_URL=http://app.lvh.me:<port>`. `lvh.me` and every name under it
resolve to 127.0.0.1 in public DNS, so no hosts-file edit is needed. Opening `localhost` or an IP address instead
shows the app but leaves private documents blank and breaks sign-in. If your DNS filter blocks `lvh.me`, point a
wildcard name at loopback and run `npm run setup -- --pages-host <hostname>`.

**First login.** Ask for a code in the browser, then read it in another terminal (nothing is mailed locally):

```sh
npm run dev:otp -- you@example.com
```

**First document.** Agents author through the skill this server serves at `<origin>/skills/artifactbin.zip`
(guide: `<origin>/llms.txt`); its `node scripts/auth.mjs` signs in. Save an HTML page as `page.html`, then
`node scripts/publish.mjs page.html` from the skill folder. To pull browser edits back, use the published
artifact ID returned by `publish.mjs`, not the file name, and preserve any unpublished local edits in a copy first:

```sh
node scripts/read.mjs <published-id> --output page.html
```

**A second copy** needs its own checkout or data directory and port: `npm run setup -- --yes --port 7445`. One
process owns a PGLite directory; the app port and the next one (`APP__HMR_PORT`) must both be free.

**Live browser sessions** need Linux bubblewrap; on macOS `npm run dev` runs the session worker uncontained
(`BROWSER__SANDBOX=none`, development only).

## On a server

Set, at least:

- `AUTH__SECRET`, stable across restarts (`openssl rand -base64 32`), and `APP__PUBLIC_BASE_URL`, the one
  canonical origin people use. In production the server refuses to start without either.
- `APP__PAGES_HOST`: over https preferably a registrable domain of its own (`__Host-` cookie, `SameSite=None;
  Partitioned`), with wildcard DNS and TLS for `*.<pages host>`. The product never provisions a hostname.
- A login method: `EMAIL__RESEND_API_KEY` or `EMAIL__SMTP_*` with `EMAIL__FROM`, and optionally Google or OIDC.
- Storage: `DATABASE_URL` for external PostgreSQL (several processes may share it), `S3_URL` for objects. Back up
  the database and the objects together before every upgrade; schema additions apply at startup.

Optional, each described where it is declared in `.env.example`: a dedicated assets origin, alias origins,
outbound IPs for firewalls, anonymous publishing hosts (`APP__USER_PAGES_HOST`), a custom shell
(`APP__SHELL_FILE`) and the product name mail uses (`APP__NAME`), skill extras (`SKILLS__EXTRA_DIR`), a default
database connection every signed-in person reads read-only (`DATASETS__DEFAULT_CONNECTION`), company mode,
test-domain accounts for automated runs, and split services (`SQL__SERVICE_URL`, `BROWSER__SERVICE_URL`,
`EVENTS__SERVICE_URL`, with `INTERNAL__SERVICE_SECRET` and `CONTRACT__ACTOR_SECRET`
matching across them; keep that network private).

- **Image exports and live sessions** need Chromium. Sessions also need bubblewrap, unprivileged user namespaces
  and a delegated cgroup v2 subtree (`BROWSER__SESSION_CGROUP_ROOT`); an ordinary container cannot run them.
- **Export uploads straight to S3** go through the upload gateway, `services/browser/src/upload-gateway-server.ts`
  (`BROWSER__UPLOAD_*`).

`/health` answers liveness; `/api/health` readiness, probing every configured remote service.

**Upgrading an old auth schema.** If startup refuses with "requires the Better Auth 1.7.3 upgrade", follow the
message: stop every writer, back up, then run `npm run migrate:account -w services/auth -- --writes-paused-backup-verified`
with `AUTH__MIGRATION_DATABASE_URL` set. It never runs at startup.

This repository has no request proxy or rate-limit policy: put your own TLS proxy in front.

## Changing the code

Read [AGENTS.md](AGENTS.md): it holds the checks (`npm run validate`, `npm test -- --files <paths>`) and the rules.
Open pull requests against `main`.
