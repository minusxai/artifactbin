# Run your own Artifactbin

Every setting is named and explained in `.env.example`; this file covers only what you have to do.

## On your machine

Requires Node.js 22+ and npm. Nothing else for the app itself: the defaults are embedded PGLite (`data/pglite`),
objects on local disk, email-code login without a mail provider and SQLite queries. Exports and live sessions
render in Chromium through Playwright, which `npm ci` does not download: run `npx playwright install chromium`
once (the command CI runs; a Linux machine may also need `npx playwright install-deps chromium`).

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
(`APP__SHELL_FILE`) and the product name mail uses (`APP__NAME`), skill extras (`SKILLS__EXTRA_DIR`), a design
system of the installation's own (`APP__DESIGN_SYSTEM_DIR`) and which system is the default
(`APP__DEFAULT_DESIGN_SYSTEM`), a default
database connection every signed-in person reads read-only (`DATASETS__DEFAULT_CONNECTION`) and whether a dataset
may have its own (`DATASETS__OWN_CONNECTIONS`), company mode,
test-domain accounts for automated runs, and split services (`SQL__SERVICE_URL`, `BROWSER__SERVICE_URL`,
`EVENTS__SERVICE_URL`, with `INTERNAL__SERVICE_SECRET` and `CONTRACT__ACTOR_SECRET`
matching across them; keep that network private).

- **Image exports and live sessions** need Chromium. Sessions also need bubblewrap, unprivileged user namespaces
  and a delegated cgroup v2 subtree (`BROWSER__SESSION_CGROUP_ROOT`); an ordinary container cannot run them.
- **Sandboxed renders**: set `BROWSER__RENDER_SANDBOX=chromium` where Chromium's own sandbox can run: a non-root
  user, unprivileged user namespaces (on Ubuntu 24.04 an AppArmor profile granting `userns`, or
  `kernel.apparmor_restrict_unprivileged_userns=0`), and a seccomp profile allowing `clone`/`unshare` of user
  namespaces, as the session containment already needs. The service then refuses to start where it cannot; `none`
  accepts running unsandboxed. Renders reach only their own origins either way: keep the browser on a private network.
- **Export uploads straight to S3** go through the upload gateway, `services/browser/src/upload-gateway-server.ts`
  (`BROWSER__UPLOAD_*`).

`/health` answers liveness; `/api/health` readiness, probing every configured remote service.
With a separate SQL service, set `SQL__QUERY_TIMEOUT_MS` equally on the app and SQL service (both default to
30 seconds; dataset writes always get 5). Readiness refuses an older service that cannot report its read policy, or a mismatched cap.

**Upgrading an old auth schema.** If startup refuses with "requires the Better Auth 1.7.3 upgrade", follow the
message: stop every writer, back up, then run `npm run migrate:account -w services/auth -- --writes-paused-backup-verified`
with `AUTH__MIGRATION_DATABASE_URL` set. It never runs at startup.

**Upgrading account preferences.** Identity now owns the existing preference rows. Stop old writers
before upgrading. A single-role install moves the table at startup. On an existing split-role install,
run the following as the database operator before starting the new hosts, substituting your schema and role names.
The move keeps the rows and their primary key. Existing identity reader views can stay in place.

```sql
BEGIN;
ALTER TABLE app.account_preferences SET SCHEMA auth;
ALTER TABLE auth.account_preferences OWNER TO artifactbin_auth;
COMMIT;
```

**Moving an issuer-owned handle to email.** Set `sub` to the verified email and include the original
handle in the signed string claim `previous_handle`. Only the issuer that bound that handle can move
its synthetic address to an unclaimed email. The account ID, handle and personal name are preserved,
and ordinary membership reconciliation still applies. Use a fresh token and unique `jti` to retry
the same address. A different address or an unknown binding refuses the entire sign-in. After success,
email sign-ins can omit `previous_handle`.

**Signed group placement.** An issuer with a configured `parentGroup` may include
`"parent_groups": ["division", "team"]` in its signed sign-in token. List existing live group handles
from parent to direct child. The first must be the configured group or a descendant. A new token group
is created directly under the last handle. An existing token group must already have that parent.
An empty, missing-member, disconnected or out-of-scope path refuses the sign-in. Omit the claim to
use the existing issuer placement rules.

**Company root membership for trusted sign-in.** Set `TRUSTED_SIGNIN__JOIN_COMPANY_ROOT=true` on the
trusted-sign-in and identity hosts only when the company root is ready for every issuer’s people.
Check its data grants and private page shares first. The setting defaults to false. Restart the hosts
after changing it. An admitted sign-in adds Member on the root and preserves any stronger role.

On enabled startup, identity backfills admitted accounts with a current seat in a configured issuer’s
live group and evidence of verified sign-in during that seat and admission. Older releases recorded
handle bindings and issuer-group creators. An older email user who joined an existing group may
have no such record and joins the root at their next verified sign-in. A manual invitation or a
removed issuer seat does not qualify. Turning the setting off stops new root grants and keeps existing seats.

**Upgrading group roles.** The old group Editor could administer members and owned files; it becomes
Admin. The old Viewer becomes Member. The new Editor publishes and edits group content, without member
administration or ownership. Artifact share roles (viewer/commenter/editor) are unchanged.

For an existing installation, stop **all** app and identity instances and pause automatic release reconciliation.
Back up the database and verify a restore on a disposable database. From the new release, run
`npm run migrate:groups -w services/auth -- --writes-paused-backup-verified`, supplying
`AUTH__MIGRATION_DATABASE_URL` through the operator's secret environment and the configured `AUTH__SCHEMA`
(default `auth`). The transaction converts memberships and pending invitations together, then records version 2.
It is safe to repeat; it never promotes a new Editor. Startup refuses unmigrated grants, including on a split app
host. Fresh empty installations initialize version 2 directly.

Start the new identity and app release together, update API/CLI clients to member/editor/admin, and verify all
three roles before resuming reconciliation. Do not run old writers or roll back only the binaries: the old
`editor` value had different authority. To roll back, stop all processes and restore the verified pre-upgrade
backup with the matching old release; preserve any post-upgrade writes separately for reconciliation.
No group nesting, personal ownership, artifact share, or external data policy is changed by this migration.
Release tooling can read `groupRoleModelVersion` from `services/auth/package.json` to reject a rolling
upgrade between incompatible role models; absence in an older package means version 1.

This repository has no request proxy or rate-limit policy: put your own TLS proxy in front.

## Changing the code

Read [AGENTS.md](AGENTS.md): it holds the checks (`npm run validate`, `npm test -- --files <paths>`) and the rules.
Open pull requests against `main`.

Named default connections use the same setting with an envelope: `{"default":{...},"connections":{"analytics":{...}}}`.
Each value is a connector configuration. A page or agent selects one with `default:analytics:database`; a plain
`default:database` keeps using the default connector. Each query runs on one connector as the signed-in reader (a page's
saved query a group Admin approved runs as that group for each signed-in account that can open the page);
credentials stay in the install settings. Names are operator-defined, lowercase, and at most 32 characters.

For a gateway accepting a database/group startup namespace, opt in only its routes with
`DATASETS__GROUP_SCOPED_CONNECTIONS` (comma-separated aliases, `@default` for the fallback). It defaults to empty.
