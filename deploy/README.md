# Deployment

Deployment belongs to this repository. Pushes to `main` run `npm run check`, then deploy that exact commit. `workflow_dispatch` redeploys main. Pull requests run checks without deployment credentials.

The deployment interface is SSH `deploy <40-character commit SHA>` with a gzip Git archive on stdin. A dedicated restricted SSH key can invoke only the host-installed deployment script. It cannot open a shell or forward ports. The host script serializes releases, builds before switching, backs up Postgres, checks container health, and restores the previous image on failure. Application credentials stay on the host.

One-time host setup:

- Install `deploy/receive.sh` as root-owned `/usr/local/sbin/pagegi-deploy`, mode 755. Install `deploy/extract.py` as root-owned `/usr/local/lib/pagegi/extract.py`.
- Keep `/opt/pagegi/.env.production`, `.env.database`, `execution-secret/transport-secret`, `resource-config/resources.json` and `postgres-data/` on the host. Environment files are mode 600. The Postgres container owns its data directory. `compose.yaml` is copied there from each release; do not edit the host copy. Configure TLS and email rate limits as described in the project README.
- Authorize a dedicated key with `restrict,command="sudo -n /usr/local/sbin/pagegi-deploy \"$SSH_ORIGINAL_COMMAND\""`. The SSH account needs permission to run that exact root-owned script. Do not reuse an administrator's private key.
- Repository secrets: `DEPLOY_KEY`, `DEPLOY_KNOWN_HOSTS`. Repository variables: `DEPLOY_HOST`, `DEPLOY_USER`, `PUBLIC_ORIGIN`. Pin known hosts using an independently verified host key.

Manual deployment uses the same entry point:

```sh
git archive --format=tar.gz HEAD | ssh -i /path/to/deploy-key user@host "deploy $(git rev-parse HEAD)"
```

Host state: `current-image` records the successful image (`.env` also pins ordinary Compose commands to it), `previous-image` the rollback target, `releases/` holds source revisions, and `backups/` holds Postgres dumps. The most recent five source releases and seven backups are retained. Docker images are retained for rollback; remove obsolete Pagegi images deliberately when needed. Do not prune unrelated Docker resources.

The deployment script itself is a privileged host dependency: changes to it require reinstalling the reviewed file through an administrator connection. The workflow does not replace its own privileged entry point.

The first Postgres release detects an existing `data/pagegi.sqlite`, stops the old app, preserves its directory, and runs the verified importer. It marks `postgres-migrated` only after the new service is healthy. Import failures restore the old image and leave both databases available for inspection. After a successful migration, never roll back to a SQLite image: subsequent writes live only in Postgres. Schema changes in later releases must remain compatible with the previous Postgres image or require an explicit data migration plan. The v2 release is the one exception: on its first start it moves a v1 database's page tables to the `<schema>_v1` schema (accounts carry over, nothing is dropped), and that schema is removed deliberately when the old pages are no longer wanted.

The TLS reverse proxy must forward WebSocket upgrades for `/api/files/*/live`. In the Pagegi location use `proxy_http_version 1.1`, `proxy_set_header Upgrade $http_upgrade`, `proxy_set_header Connection "upgrade"`, and `proxy_read_timeout 60s`. Server heartbeats run every 10 seconds. Authentication is the first WebSocket frame, never a URL parameter or cookie; allow `Origin: null` for local HTML files. Keep the app at one replica until rooms have a shared broker.

Readable HTML hosting requires both `PAGEGI_PLATFORM_ORIGIN` (for example `https://app.example.com`) and `PAGEGI_RUNNER_ORIGIN` (for example `https://{document}.runner.example.net`). Configure wildcard DNS and TLS for the runner domain, forwarding both domains to this service with the original `Host` header. The runner must not be a subdomain of the platform hostname; it serves only the empty runner and its bootstrap, never account or document APIs. Unconfigured hosting accepts only loopback development requests. Do not expose the development runner ports as a production substitute.

## Optional backend execution

Backend execution is disabled by default. The available prototype adapter is a local Docker executor selected by `PAGEGI_BACKEND_EXECUTOR=docker`; `PAGEGI_BACKEND_IMAGE` optionally overrides `pagegi-backend:local`. Build it with `npm run build:backend`. The process running Pagegi must be deliberately configured to access that Docker engine. Backends run on whatever image that tag names when they are called, so rebuilding or redeploying it keeps every published backend working; bump `BACKEND_RUNTIME` in `src/backend/deployment.ts` when the container changes what a compiled bundle needs, and the server recompiles older backends on their first call.

Production runs backends through the `execution` service of `compose.yaml` ([`execution-service.md`](execution-service.md)), with `PAGEGI_BACKEND_EXECUTOR=remote`. Every deployment builds `pagegi-backend:<sha>` from the release beside the app image, copies the release's `compose.yaml` to the host, and brings the whole composition up with both images (`PAGEGI_IMAGE`, `PAGEGI_BACKEND_IMAGE`, also written to `.env`); `current-backend-image` and `previous-backend-image` are kept beside the app's for rollback. The app and the execution service therefore always run the same revision, which matters: the sandbox image is what compiles backend files, so an older one rejects files written for the current skill.

The app service runs non-root with a read-only filesystem and never gets the Docker socket; only the execution service does, and it holds no application credential. Setting the environment variable alone does not add execution support. Missing or unavailable execution fails closed instead of running author code in the server process.

Compilation runs in a fresh constrained container with no network; one warm container per backend version serves its calls on the `pagegi-sandbox` bridge and is reaped when idle, and there lambdas reach public addresses only (workerd's policy, plus the `pagegi-sbx` iptables rules `receive.sh` installs as `pagegi-sandbox-egress.service`, reapplied at boot, after Docker restarts and on every deployment). Neither gets host mounts or service credentials, and both have bounded memory/CPU/processes/time. Source, immutable compiled versions and the active-version pointer persist in PostgreSQL and are included in its backups. Source audits are owner-only; schema and invocation require authenticated document access. Every viewer who can open a page can call its backends; `@auth` on a field is the only gate.

See [the execution contract](../src/backend/README.md) for exact limits. Run `npm run build:backend`, then `node --import tsx --test test/backend-repository.test.ts test/backend-e2e.test.ts` and `npm run test:backend-browser` for the real SQL/CLI/HTTP/container and browser integration checks. These tests exercise the local executor; they do not establish that an arbitrary production host or the existing Compose service has been configured to run it.
