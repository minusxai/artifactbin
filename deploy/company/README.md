# Company hosting with Docker Compose

This bundle runs one `afbin serve` process, a separate PostgreSQL container on the same Linux box, and Caddy for HTTPS. It builds its own application image from **@afbin/cli 0.5.25**; no public Artifactbin Docker image is assumed. Caddy **2.11.7** terminates HTTPS. PostgreSQL **17.11** is a supported release ([version policy](https://www.postgresql.org/support/versioning/), [official image tags](https://github.com/docker-library/official-images/blob/master/library/postgres)). Keep minor/security releases current after testing upgrades; major database upgrades require PostgreSQL migration, not changing an image tag on an existing volume.

Use a Linux server with Docker Engine, Compose v2.30+, Node 22+, `tar` and `flock`. A practical starting point is 2 vCPU, 4 GiB RAM and encrypted persistent disk; size for real use. Open inbound TCP 80/443 only (plus restricted administrative access). Do not publish PostgreSQL or the app port. EC2 Mumbai (`ap-south-1`) is suitable for India-based users. This single-box design survives process/container restarts but is not highly available; host/disk loss requires an off-box backup.

## 1. DNS and certificates

Choose a public application hostname, for example `dashverse.artifactbin.dev`. Configure DNS pointing to the server's stable IP for all three:

- `dashverse.artifactbin.dev`
- `pages.dashverse.artifactbin.dev`
- `*.pages.dashverse.artifactbin.dev`

Do not substitute `*.dashverse.artifactbin.dev`: it does not cover individual document hostnames. The app and document hosts must be on the same site so authenticated private documents work.

Wildcard certificates need a DNS challenge. **Select your actual DNS provider**, its explicitly pinned [Caddy DNS module](https://caddyserver.com/docs/modules/), and its documented credentials before starting. Stock Caddy does not include provider modules; `Caddy.Dockerfile` builds the selected one. Give it DNS access scoped to this zone. Credentials belong only in `secrets/dns.env`, never in the app configuration or image. For Route53 on EC2 prefer a scoped instance role; ensure containers can reach IMDSv2 (appropriate metadata hop limit) and do not configure static AWS keys. Other providers use their module's credential names. See [Caddy DNS challenge configuration](https://caddyserver.com/docs/caddyfile/directives/tls#dns).

## 2. Initialize private configuration

Copy this directory to a new operator directory on the server. Supply the following environment variables through your protected configuration mechanism (avoid secrets in shell history):

```dotenv
APP_HOSTNAME=dashverse.artifactbin.dev
PAGES_HOSTNAME=pages.dashverse.artifactbin.dev
OWNER_EMAIL=owner@company.example
ALLOWED_EMAIL_PATTERNS=*@company.example
ACME_EMAIL=ops@company.example
DNS_MODULE=github.com/caddy-dns/<actual-provider>@v<tested-version>
EMAIL__RESEND_API_KEY=<credential>
EMAIL__FROM=Dashverse <login@verified-sender.example>
```

Then `node init.mjs .`. The initializer generates independent random database and authentication secrets and refuses an already initialized directory. Generated files are mode 0600; the app configuration is owned by the nonroot container UID selected in `.env`. Run initialization as the operator account that owns this deployment directory; when run as root it uses UID/GID 1000 and assigns configuration ownership accordingly. Do not copy generated files into Git. Preserve `AUTH__SECRET` across upgrades/restores.

The sender/domain must already be verified in Resend. Instead of Resend, supply both `AUTH__GOOGLE_CLIENT_ID` and `AUTH__GOOGLE_CLIENT_SECRET`, or a complete OIDC configuration from [server.env.example](../../docs/extraction/server.env.example). Register the application's login redirect URI with that provider. There is no local OTP outbox on this external host and no SMTP option.

Complete `dns-provider.caddy` with your selected module's TLS block. Example **only if the selected provider is Route53**:

```caddyfile
tls {
    dns route53 {
        region ap-south-1
    }
}
```

Route53 uses its AWS credential chain; a scoped EC2 role requires no values in `secrets/dns.env`. For a different provider, use its documented `dns <provider>` block and environment placeholders for credentials. The initializer deliberately leaves this file incomplete until you choose a provider: never start without reviewing it. Do not mount secrets in the builder or place them in Docker build arguments.

## 3. Build and start

```sh
docker compose config --quiet
docker compose build
docker compose run --rm --no-deps caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d
docker compose ps
```

Before using a candidate release, copy the **exact CI-tested npm tarball** to `packages/afbin.tgz`, verify its provenance/checksum, and build with `AFBIN_PACKAGE=/packages/afbin.tgz docker compose build`. The Dockerfile still checks its version is 0.5.25. After publishing, the normal build installs that exact pinned registry version. Record the image IDs/digests you deploy. Node's base image is pinned to supported major 22; pin its tested digest for your deployment when you finish acceptance. The Compose application image runs nonroot. A short, network-disabled root helper initializes artifact-volume ownership; it never starts the application.

Only Caddy exposes ports. PostgreSQL uses an internal network and Docker secret file. The app's persistent volume contains uploaded artifacts, runtime state and its lazy Chromium cache; the database has its own volume. The image installs Chromium's Linux dependencies, and the first export downloads the package's matching Chromium build into `/data/chromium`. Outbound access to its download service and the login provider is required. Exercise PNG/PDF export during acceptance to warm and verify this path.

## 4. Owner and colleagues

Open the public hostname and sign in using the configured verified owner email. Create/select an editor company group and explicitly confirm deployment setup. Invite each colleague to that group as editor or viewer **before** they sign in. No environment variable or initialization script bypasses this onboarding.

Colleagues install the CLI on their own computers (not in the server container):

```sh
npx --yes @afbin/cli@0.5.25 setup --server https://dashverse.artifactbin.dev --group <company-handle> --set-default
```

They authenticate as themselves. New publications use their verified account/deployment default; existing personal documents are not transferred. Group viewers can read and discover private company artifacts; editors can create/edit/comment. Individual document shares can grant commenter access separately, and do not admit an account to the company. Use the group's **Copy agent setup** command to avoid mistyping the origin/handle. See [company permissions](../../docs/extraction/team.md#owner-setup-and-colleague-permissions).

## 5. Acceptance before real company rollout

On a disposable external deployment, using normal login from another machine/network:

1. Verify HTTPS on the application, pages host, and a real document subdomain.
2. Install from the copied instructions in fresh isolated client directories. Verify real login delivery, owner confirmation, and rejection of an uninvited account.
3. Invite editor/viewer colleagues; publish without a group override and verify both artifacts land in the company group and appear for every member in browser and CLI.
4. Verify reads, editor edits/comments, viewer write denial, individual commenter permissions, anonymous private denial, and immediate membership/share revocation.
5. Export PNG/PDF; restart the containers and verify identities, group defaults, edits, objects and exports persist.
6. Take a consistent backup, restore it on a fresh deployment with the same host/config, and verify login plus private artifact content and permissions. Keep the original stopped while verifying the replacement; never run two writers against one data volume.

Finish these checks **before** provisioning the separate real company instance. Repeat acceptance on its actual origin and record source/package/image hashes and results.

## Backups, restore and upgrades

`./backup.sh` stops the app (brief downtime), dumps PostgreSQL, archives artifact storage, and saves configuration including the persistent auth secret and provider credentials. It restarts the app even if a backup fails. Caddy certificate caches are renewable and need not be restored. Do not take a live filesystem copy independently of a database dump: the two halves must describe the same stopped writer. Encrypt completed backup directories, store them off this box, and test recovery. This assumes only the app writes to the database/artifact volume.

Restore into a fresh copy of this bundle with a new Compose project/empty volumes: `./restore.sh /absolute/path/to/backup`. It restores saved configuration, builds images, waits for PostgreSQL readiness, refuses nonempty database/artifact volumes, restores both halves, and starts the deployment. Backups are trusted operator archives containing secrets; never restore untrusted input. If moving machines, retain the generated UID/GID or correct ownership before startup. The script does not modify DNS; move DNS only after verification.

For an app upgrade: backup first, update the pinned CLI version in the bundle, build/test the candidate, then `docker compose up -d`. Keep rollback copies of both data and configuration because application database migrations can make an older binary incompatible. Never use `docker compose down --volumes` on a real deployment. Lambda execution is separate and requires the [runner controller](../../services/runner/README.md).

## CI container acceptance

The required company-container job downloads the exact `cli-pack` tarball and builds the app and Caddy images (Caddy 2.11.7 with Route53 module v1.6.2). It proves nonroot configuration readability, real PostgreSQL migrations, the pinned Chromium installer plus a screenshot, restart persistence, consistent backup, and fresh restore retaining the authentication secret. Its fake mail key is never used to send messages; Caddy issuance does not run in CI. Real external DNS/TLS, email and company collaboration are separate acceptance checks above. Failures block the required rollup; this job runs for company bundle changes and CLI releases, and tested-tree evidence is reused on merge.
