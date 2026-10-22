# Independent HTML product deployment

The product branch has its own deployment environment, `artefactv2`. Pull requests run validate and unit tests; pushes to `artefactv2` run the complete container and security checks before deployment. Main never deploys through this workflow. Configure these environment secrets: `ARTEFACTV2_DEPLOY_KEY`, `ARTEFACTV2_DEPLOY_KNOWN_HOSTS`; configure these environment variables: `ARTEFACTV2_DEPLOY_HOST`, `ARTEFACTV2_DEPLOY_USER`, `ARTEFACTV2_PUBLIC_ORIGIN`. No older deployment credential or destination is used as a fallback.

Install the reviewed `deploy/receive-artefactv2.sh` as root-owned `/usr/local/sbin/artefactv2-deploy`, mode755, and `deploy/extract.py` at `/usr/local/lib/artefactv2/extract.py`. Restrict a dedicated deployment key to `sudo -n /usr/local/sbin/artefactv2-deploy "$SSH_ORIGINAL_COMMAND"`, with SSH's `restrict` option and narrowly scoped sudo authorization. The privileged receiver is installed by an administrator, never replaced by an uploaded release. The upload protocol remains `deploy <40-character SHA>` with the tested Git archive on stdin.

Provision `/opt/artefactv2/.env.production`, `.env.database`, `execution-secret/transport-secret`, and `resource-config` privately. The app and execution secret must be readable by container UID1000. Use independent admin (`POSTGRES_PASSWORD`) and app (`ARTEFACTV2_APP_DATABASE_PASSWORD`) passwords in `.env.database`. The fresh-volume init script creates the nonsuperuser `artefactv2` app role, granting schema creation only inside the new database and no cluster authority. `PAGEGI_DATABASE_URL` in `.env.production` uses the app password, targeting `postgres:5432/artefactv2` as role `artefactv2`; the bootstrap admin is `artefactv2_admin` and is used only for initialization and backups. Initialization refuses a missing app password. Never point this application at another deployment's database or bind mount. Set the platform and per-page runner origins explicitly; the runner may not be a descendant of the platform hostname. Set `PAGEGI_BACKEND_EXECUTOR=remote`, `PAGEGI_EXECUTION_SECRET_FILE=/run/pagegi-execution-secret/transport-secret`, and app email/auth settings as required. The receiver reads `DOCKER_GID` from the host socket when deploying.

The separate Compose project is `artefactv2`, release root `/opt/artefactv2`, images `artefactv2:<sha>` and `artefactv2-backend:<sha>`, loopback ingress8897. It has an independent PostgreSQL container and data directory, release lock, backups, current/previous image pointers and rollback. Its execution controller has deployment identity `artefactv2`, owning only `artefactv2.backend=1` containers, the `artefactv2-sandbox` network and `artefactv2-sb` bridge. Egress rules use `ARTEFACTV2-SANDBOX` and `artefactv2-sandbox-egress.service`. The legacy default identifiers remain unchanged for other installations. Queues and warm pools are controller-local. Both controllers still have host Docker authority; stronger isolation requires separate engines.

Route public hosts to loopback8897 with the original Host header. Provision matching wildcard DNS/TLS for runner hostnames; a certificate for `*.example.test` does not cover `*.runner.example.test`. Validate nginx before reloading and preserve unrelated hosts. Credentials and concrete host topology belong in private provisioning, not committed configuration.

The execution controller also uses the fixed SQL job image
`artefactv2-dataset-sql:<sha>`, built from the release project context with
`src/datasets/sql/container/Dockerfile`. Only execution receives
`PAGEGI_DATASET_SQL_IMAGE`; the application has no Docker socket. Every gated
release builds all three immutable images. Current/previous dataset SQL pointers
and the Compose `.env` follow successful deployment and rollback alongside the
existing app/backend pointers. No existing backend image tag is reused for SQL.
CI caches SQL images independently by every copied SQL source and mutation wire
contract, and prepares the image for all isolate suites. Local isolate setup builds
it with `npm run build:dataset-sql`.

Dataset mutation objects use a separate app-only writable overlay
`./dataset-mutations` (UID1000, mode0700), configured by
`PAGEGI_DATASET_MUTATION_DIRECTORY=/run/pagegi-dataset-mutations`. Imported
dataset objects remain read-only. Neither execution nor SQL jobs mount this
overlay; the fixed SQL job receives only bounded input through its transport.
