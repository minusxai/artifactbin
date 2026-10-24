# Company hosting with Docker Compose

This bundle runs one `afbin serve` process, a separate PostgreSQL container on the same Linux box, and Caddy for HTTPS. It builds its own application image from **@afbin/cli 0.5.27**; no public Artifactbin Docker image is assumed. Caddy **2.11.7** terminates HTTPS. PostgreSQL **17.11** is a supported release ([version policy](https://www.postgresql.org/support/versioning/), [official image tags](https://github.com/docker-library/official-images/blob/master/library/postgres)). Keep minor/security releases current after testing upgrades; major database upgrades require PostgreSQL migration, not changing an image tag on an existing volume.

Use a Linux server with Docker Engine, Compose v2.30+, Docker Buildx v0.17+, Node 22+, `tar` and `flock`. Verify both `docker compose version` and `docker buildx version`: some distribution Docker packages omit these plugins. Install missing plugins from Docker's official releases and verify their published checksums before building. A practical starting point is 2 vCPU, 4 GiB RAM and encrypted persistent disk; size for real use. Open inbound TCP 80/443 only (plus restricted administrative access). Do not publish PostgreSQL or the app port. EC2 Mumbai (`ap-south-1`) is suitable for India-based users. This single-box design survives process/container restarts but is not highly available; host/disk loss requires an off-box backup.

## 1. DNS and certificates

Choose a public application hostname, for example `company.example.com`. Configure DNS pointing to the server's stable IP for all three:

- `company.example.com`
- `pages.company.example.com`
- `*.pages.company.example.com`

Do not substitute `*.company.example.com`: it does not cover individual document hostnames. The app and document hosts must be on the same site so authenticated private documents work.

Wildcard certificates need a DNS challenge. **Select your actual DNS provider**, its explicitly pinned [Caddy DNS module](https://caddyserver.com/docs/modules/), and its documented credentials before starting. Stock Caddy does not include provider modules; `Caddy.Dockerfile` builds the selected one. Give it DNS access scoped to this zone. Credentials belong only in `secrets/dns.env`, never in the app configuration or image. For Route53 on EC2 prefer a scoped instance role; ensure containers can reach IMDSv2 (appropriate metadata hop limit) and do not configure static AWS keys. Other providers use their module's credential names. See [Caddy DNS challenge configuration](https://caddyserver.com/docs/caddyfile/directives/tls#dns).

## 2. Initialize private configuration

Copy this directory to a new operator directory on the server. Supply the following environment variables through your protected configuration mechanism (avoid secrets in shell history):

```dotenv
APP_HOSTNAME=company.example.com
PAGES_HOSTNAME=pages.company.example.com
OWNER_EMAIL=owner@company.example
ALLOWED_EMAIL_PATTERNS=*
ACME_EMAIL=ops@company.example
DNS_MODULE=github.com/caddy-dns/<actual-provider>@v<tested-version>
EMAIL__SMTP_HOST=smtp.example.com
EMAIL__SMTP_PORT=587
EMAIL__SMTP_SECURE=false
EMAIL__SMTP_USER=<SMTP username>
EMAIL__SMTP_PASSWORD=<SMTP password>
EMAIL__FROM=Example Company <login@verified-sender.example>
```

`ALLOWED_EMAIL_PATTERNS=*` permits invited colleagues from any email domain; company admission remains invite-only. Set a narrower email glob when your company requires it. The owner address is always supplied explicitly.

Then `node init.mjs .`. The initializer generates independent random database and authentication secrets and refuses an already initialized directory. Generated files are mode 0600; the app configuration is owned by the nonroot container UID selected in `.env`. Run initialization as the operator account that owns this deployment directory; when run as root it uses UID/GID 1000 and assigns configuration ownership accordingly. Do not copy generated files into Git. Preserve `AUTH__SECRET` across upgrades/restores.

Use an SMTP sender authorized by your provider. Port 587 requires STARTTLS; `EMAIL__SMTP_SECURE=true` uses implicit TLS with default port 465. Certificate verification stays enabled; provide both username/password, or neither only for a trusted TLS relay. Alternatively choose Resend with `EMAIL__RESEND_API_KEY` plus its verified sender in `EMAIL__FROM`; do not configure both transports. Instead of email codes, supply both `AUTH__GOOGLE_CLIENT_ID` and `AUTH__GOOGLE_CLIENT_SECRET`, or a complete OIDC configuration from [server.env.example](../../docs/extraction/server.env.example). Register the application's login redirect URI with that provider. There is no local OTP outbox on this external host.

For Amazon SES in Mumbai, use `EMAIL__SMTP_HOST=email-smtp.ap-south-1.amazonaws.com`, port 587, `EMAIL__SMTP_SECURE=false`, and the provider's SMTP username/password. An example shared sender is `Example Company login <login@verify.example.com>` after that sending domain is verified; each company can use a separate credential restricted to its authorized sender. SES SMTP credentials differ from AWS access keys, and sandbox accounts also require verified recipients until production sending access is approved. See [SES SMTP requirements](https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html).

Complete `dns-provider.caddy` with your selected module's TLS block. Example **only if the selected provider is Route53**:

```caddyfile
tls {
    dns route53 {
        region ap-south-1
    }
    propagation_delay 60s
    propagation_timeout 5m
}
```

Route53 uses its AWS credential chain; a scoped EC2 role requires no values in `secrets/dns.env`. The propagation wait gives its authoritative servers time to serve a DNS challenge consistently before certificate validation. For a different provider, use its documented `dns <provider>` block and environment placeholders for credentials. The initializer deliberately leaves this file incomplete until you choose a provider: never start without reviewing it. Do not mount secrets in the builder or place them in Docker build arguments.

## 3. Build and start

```sh
docker compose config --quiet
docker compose build
docker compose run --rm --no-deps caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d
docker compose ps
```

On first startup, certificate issuance follows container startup and can take several minutes. Check `docker compose logs caddy` for successful certificate issuance for the application, pages host and wildcard. Verify the public HTTPS hosts before signing in; a healthy app container alone does not prove HTTPS is ready. If issuance fails, correct DNS/provider access and inspect Caddy's retries; do not bypass browser certificate warnings.

Before using a candidate release, copy the **exact CI-tested npm tarball** to `packages/afbin.tgz`, verify its provenance/checksum, and build with `AFBIN_PACKAGE=/packages/afbin.tgz docker compose build`. The Dockerfile checks that its installed version matches `AFBIN_VERSION`. After publishing, the normal build installs that exact pinned registry version. Record the image IDs/digests you deploy. Node's base image is pinned to supported major 22; pin its tested digest for your deployment when you finish acceptance. The Compose application image runs nonroot. A short, network-disabled root helper initializes artifact-volume ownership; it never starts the application.

Keep the entire `runtime-source/` directory with the Dockerfile when copying the bundle. The image builds verified upstream runtime sources on its pinned Debian base, retains their test and integrity checks, and installs packages with explicit source versions. The build tools remain in intermediate stages. Backups preserve these build inputs for recovery.

Only Caddy exposes ports. PostgreSQL uses an internal network and Docker secret file. The app's persistent volume contains uploaded artifacts, runtime state and its lazy Chromium cache; the database has its own volume. The image installs Chromium's Linux dependencies, and the first export downloads the package's matching Chromium build into `/data/chromium`. Outbound access to its download service and the login provider is required. Exercise PNG/JPG export during acceptance to warm and verify this path.

## 4. Owner and colleagues

Open the public hostname and sign in using the configured verified owner email. Create/select an editor company group and explicitly confirm deployment setup. Invite each colleague to that group as editor or viewer **before** they sign in. No environment variable or initialization script bypasses this onboarding.

Colleagues install the CLI on their own computers (not in the server container):

```sh
npx --yes @afbin/cli@0.5.27 setup --server https://company.example.com --group <company-handle> --set-default
```

They authenticate as themselves. New publications use their verified account/deployment default; existing personal documents are not transferred. Group viewers can read and discover private company artifacts; editors can create/edit/comment. Individual document shares can grant commenter access separately, and do not admit an account to the company. Use the group's **Copy agent setup** command to avoid mistyping the origin/handle. See [company permissions](../../docs/extraction/team.md#owner-setup-and-colleague-permissions).

## 5. Acceptance before real company rollout

On a disposable external deployment, using normal login from another machine/network:

1. Verify HTTPS on the application, pages host, and a real document subdomain.
2. Install from the copied instructions in fresh isolated client directories. Verify real login delivery, owner confirmation, and rejection of an uninvited account.
3. Invite editor/viewer colleagues; publish without a group override and verify both artifacts land in the company group and appear for every member in browser and CLI.
4. Verify reads, editor edits/comments, viewer write denial, individual commenter permissions, anonymous private denial, and immediate membership/share revocation.
5. Export PNG/JPG; restart the containers and verify identities, group defaults, edits, objects and exports persist.
6. Take a consistent backup, restore it on a fresh deployment with the same host/config, and verify login plus private artifact content and permissions. Keep the original stopped while verifying the replacement; never run two writers against one data volume.

Finish these checks **before** provisioning the separate real company instance. Repeat acceptance on its actual origin and record source/package/image hashes and results.

## Backups, restore and upgrades

`./backup.sh` stops the app (brief downtime), dumps PostgreSQL, archives artifact storage, and saves configuration including the persistent auth secret, provider credentials, and optional local npm packages needed to rebuild the same image. It restarts the app even if a backup fails. Caddy certificate caches are renewable and need not be restored. The artifact archive leaves out `/data/chromium`, the package's re-installable browser download: a restored deployment downloads it again on its first PNG/JPG export (or run `docker compose exec app afbin setup --service chromium` after restoring), so that host needs the same outbound access as the first install. Do not take a live filesystem copy independently of a database dump: the two halves must describe the same stopped writer. Encrypt completed backup directories, store them off this box, and test recovery. This assumes only the app writes to the database/artifact volume.

Copy `backup.sh` and `restore.sh` into a fresh deployment directory with a new Compose project/empty volumes, then run: `./restore.sh /absolute/path/to/backup`. It restores saved configuration, builds images, waits for PostgreSQL readiness, refuses nonempty database/artifact volumes, restores both halves, and starts the deployment. Backups are trusted operator archives containing secrets; never restore untrusted input. If moving machines, retain the generated UID/GID or correct ownership before startup. The script does not modify DNS; move DNS only after verification.

For an app upgrade: backup first, update the pinned CLI version in the bundle, build/test the candidate, then `docker compose up -d`. Keep rollback copies of both data and configuration because application database migrations can make an older binary incompatible. Never use `docker compose down --volumes` on a real deployment. Lambda execution is separate and requires the [runner controller](../../services/runner/README.md).

## CI container acceptance

The required company-container job downloads the exact `cli-pack` tarball and builds the app and Caddy images (Caddy 2.11.7 with Route53 module v1.6.2). It proves nonroot configuration readability, real PostgreSQL migrations, the pinned Chromium installer plus a screenshot, restart persistence, consistent backup, and fresh restore retaining the authentication secret, then reinstalls Chromium in the restored deployment and exports a screenshot. A private SMTP sink receives an actual owner email-code request over authenticated STARTTLS with a trusted test certificate; mail never leaves CI. Caddy issuance does not run in CI. Real external DNS/TLS, email and company collaboration are separate acceptance checks above. Failures block the required rollup; this job runs for company bundle changes and CLI releases, and tested-tree evidence is reused on merge.
