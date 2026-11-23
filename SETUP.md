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
- The optional `LOGIN__SSO_URL` adds a link alongside the email-code form on `/login`. Set it to the public HTTPS URL that starts your configured sign-in flow. HTTP is supported on local development hosts. An empty URL hides the link. `LOGIN__SSO_LABEL` defaults to “Sign in with company”. Both settings are public. Configure authentication at the destination separately.
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
and listed groups receive their memberships. Use a fresh token and unique `jti` to retry
the same address. On first use, a free handle and an unclaimed email create one person atomically.
An occupied email, a handle held by another identity, or a later change of address refuses the sign-in.
After success, email sign-ins can omit `previous_handle`.

**Signed group placement.** Set the issuer's `parentGroup` to an existing group handle or ID.
The signing host sends a `groups` array. For example, the application fields for a verified person
with two groups under the existing `operators` handle look like this:

```json
{
  "sub": "sam@example.com",
  "name": "Sam",
  "groups": [
    {"handle":"group_north","name":"North","tenancy_id":"op_101","parent_handles":["operators"]},
    {"handle":"group_south","name":"South","tenancy_id":"op_202","parent_handles":["operators"]}
  ],
  "active_group": "group_north"
}
```

The usual signed `iss`, `aud`, `iat`, `exp` and single-use `jti` accompany those fields. Each
`parent_handles` path lists existing live handles from outermost to innermost. The first handle
must resolve to the configured ceiling or a descendant. A new group is created directly under the
last handle. An existing group must belong to the same issuer and already have the specified
parent. The sign-in can update its display name and tenancy ID. A conflicting handle or hierarchy
rolls back the entire request. The optional `active_group` must be a listed handle. Omitting it
opens the first listed group. Every listed group receives a direct Member grant if the person
has no seat there. Existing roles and memberships persist across sign-ins, including omitted groups.
An empty list refuses sign-in without changing identity data. Each signed request accepts up to
256 groups, up to 16 parent handles per group, and a form body up to 1 MiB.

Deploy the receiver and all signing hosts together. Single-group signers also send the array.
Configure every signing key's `parentGroup` before starting the new version. Verify both sign-in
hosts with the same test identity before enabling entry points. A rollback requires restoring
both receiver and signing hosts together.

**Binding a person to a tenant on PostgreSQL.** Use the identity operator command once every
consumer that enforces warehouse tenancy understands `identity.users.tenancy_id`. Supply the
reviewed database through the protected `AUTH__MIGRATION_DATABASE_URL` environment variable and set
`AUTH__SCHEMA` when customized. The database role needs read and update access to the identity
account table. Use the stable account ID and the expected current binding. An empty argument
means no binding. The update refuses a missing account or a changed binding.

```sh
npm run set:person-tenancy -w services/auth -- <person-id> '' <tenant-id>
```

To clear a binding, pass the current tenant ID as the expected value and an empty final argument.
A binding belongs to the account and remains in place when its group memberships or profile change.

**Preparing a new company root on PostgreSQL.** Use this operator command for an already configured
company that needs to place existing roots under a fresh root. Pause app and identity writers and
automatic reconciliation, and verify a restorable backup. On the reviewed database, read
`owner_user_id` and `default_group_id` from `app.deployment_state` (row `company`), and `revision`
from `auth.group_hierarchy` (row `installation`). Use the configured schemas if they differ.
Supply the operator database connection through `AUTH__MIGRATION_DATABASE_URL` in the protected
environment. The operator needs write access to the identity tables and group audit, and permission
to lock the company state and settings rows. Set `APP__SCHEMA` and `AUTH__SCHEMA` if customized.

```sh
npm run prepare:company-root -w services/auth -- --writes-paused-backup-verified \
  <owner-id> <current-default-id> <hierarchy-revision> <fresh-handle> 'Company root'
```

The command prints the new group ID. It creates an empty, independent root with only the
designated owner as direct Admin, and records `company_root_prepared`. The expected owner, live
default root and hierarchy revision must still match. If output was lost, look up the handle and
audit on the reviewed database before taking another action. A repeat with the same revision
refuses and an occupied handle is never reused. A failed preparation rolls back the group,
membership, handle reservation, audit and revision together.

Keep trusted root enrollment off during the change. Resume the services for the authenticated
steps. As the designated owner, send `POST /api/deployment/setup` with JSON
`{"group_id":"<new-root-id>"}` to explicitly select the new root. This is the step that changes
the company default and records `company_default_changed`. New ordinary admissions use that default,
subject to the admissions policy. The default also backs the inherited home and serves as the publishing
fallback when no explicit, parent or account destination applies and the publisher has the required
role. Existing admissions, preferences and memberships carry forward. The trusted root, when enrollment is enabled, is the live root above
the default. Reparenting the old default before selection can therefore change the trusted root
even while the stored default still points to the old group.

Use `groups reparent GROUP --parent GROUP --yes` for each existing root being moved. The
authenticated actor must have Admin on each moved group and on the new parent. Arrange any
needed branch-role change explicitly with an existing branch Admin. Moving a branch keeps its
group ID, direct roles, owned pages and subtree, including existing issuer parents. The new root's
Admins inherit Admin over attached branches. Root members do not inherit branch memberships, and
branches' members can receive shares to their ancestors. Verify branch access, issuer placement
and the admission cohort before separately enrolling or promoting anyone on the root, or enabling
trusted root enrollment.

**Enrolling previously admitted accounts after the default move (PostgreSQL).** After selecting
the prepared root, pause all app and identity writers and automatic reconciliation again, and verify a
restorable backup. Keep automatic trusted root enrollment off. Use the same operator connection and
schemas as for preparation. The app and identity runtime roles retain their existing permissions.
Generate a plan into a private file outside the repository. Use `npm --silent` to capture only JSON.

```sh
umask 077
npm --silent run enroll:company-root -w services/auth -- --writes-paused-backup-verified \
  <owner-id> <new-default-id> plan > /private/path/root-enrollment.json
npm --silent run enroll:company-root -w services/auth -- --writes-paused-backup-verified \
  <owner-id> <new-default-id> apply /private/path/root-enrollment.json
```

Review the full account list and revisions before apply. The proposed additions are the rows with
`role: null` and `removed: false`. The plan includes active email accounts admitted by the time of
the move and still admitted at review, whether or not they have an issuer seat. Review what the root
already exposes before adding Members. The command checks the designated owner, live root, audited
default move, role model, hierarchy revision and account and seat snapshot again under lock. If the
plan changed, generate and review a fresh one. Discard superseded plans and plans from before a
restore or database replacement.

Apply adds missing direct Member seats and records `company_root_enrolled` atomically. It preserves
existing roles and skips previously audited removals. An exact retry reports `already_applied`.
The completion audit is retained for the root's lifetime so later removals and revocations survive
retries. The command changes only root memberships and their audit. Run it once on each installation
that needs enrollment, then resume services.

**Company root membership for trusted sign-in.** Set `TRUSTED_SIGNIN__JOIN_COMPANY_ROOT=true` on the
trusted-sign-in and identity hosts only when the company root is ready for every issuer’s people.
Check its data grants and private page shares first. The setting defaults to false. Restart the hosts
after changing it. An admitted sign-in adds Member on the root and preserves any stronger role.

On enabled startup, identity backfills admitted accounts with a current seat in a configured issuer’s
live group, including people added manually or moved between host groups. Each grant is recorded
for that root. Later startups preserve a removal from the root, including grants recorded by an earlier
release. Turning the setting off stops new root grants and keeps existing seats.

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
