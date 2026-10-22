# Independent HTML product deployment

The product branch has its own deployment environment, `artefactv2`. Pull requests run validate and unit tests; pushes to `artefactv2` run the complete container and security checks before deployment. Main never deploys through this workflow. Configure these environment secrets: `ARTEFACTV2_DEPLOY_KEY`, `ARTEFACTV2_DEPLOY_KNOWN_HOSTS`; configure these environment variables: `ARTEFACTV2_DEPLOY_HOST`, `ARTEFACTV2_DEPLOY_USER`, `ARTEFACTV2_PUBLIC_ORIGIN`. No older deployment credential or destination is used as a fallback.

Install the reviewed `deploy/receive-artefactv2.sh` as root-owned `/usr/local/sbin/artefactv2-deploy`, mode755, and `deploy/extract.py` at `/usr/local/lib/artefactv2/extract.py`. Restrict a dedicated deployment key to `sudo -n /usr/local/sbin/artefactv2-deploy "$SSH_ORIGINAL_COMMAND"`, with SSH's `restrict` option and narrowly scoped sudo authorization. The privileged receiver is installed by an administrator, never replaced by an uploaded release. The upload protocol remains `deploy <40-character SHA>` with the tested Git archive on stdin.

Provision `/opt/artefactv2/.env.production`, `.env.backup`, `database-ca.pem`,
`execution-secret/transport-secret`, and `resource-config` privately. The application
uses the existing remote database with `PAGEGI_DATABASE_SCHEMA=artefactv2` and a
restricted login that owns only the runtime schema, without database creation,
role administration, or access to the older deployment's schemas. The migration
archive is the separate `artefactv2_migration` schema. Provision and copy data under
coordinated maintenance before changing the application URL; the receiver never
creates a database or role. Preserve the old database and its data during cutover.

Set `PAGEGI_DATABASE_URL` privately with certificate verification enabled:
`sslmode=verify-full&sslrootcert=/run/pagegi/database-ca.pem`. The public CA bundle
is mounted read-only; the application and transport secret must be readable by
container UID1000. Set platform and runner origins explicitly, remote execution
configuration, and email/auth settings as required. Concrete connection addresses
and credentials belong only in private provisioning.

The composition runs the app and its execution controller, with no PostgreSQL
service or local database dependency. Existing local database volumes are never
removed by deployment. The project retains its independent release lock, object
mounts, backups and current/previous image pointers. Backend and image containers
keep their separate deployment ownership labels; the application has no Docker
socket. Both controllers still have host Docker authority; stronger separation
requires separate engines.

Before each rollout, `backup-schema.py` reads root-private mode0600 `.env.backup`
as literal libpq `KEY=value` lines. Supply `PGHOST`, `PGDATABASE`, `PGUSER`,
`PGPASSWORD`, `PGSSLMODE=verify-full`, `PGSSLROOTCERT` (the host CA path), and
optionally `PGPORT`. The backup login must read both exact schemas `artefactv2`
and `artefactv2_migration`; it need not administer the shared database. Backup
commands never include a connection URI or password in their arguments. A custom
archive contains only these schemas and excludes ownership and privilege grants.
Before publishing the dump and its `.verified` marker, the receiver restores it
with `--exit-on-error` into a disposable offline PostgreSQL verifier: no network,
ports, production mounts or credentials, read-only root filesystem and a private
Docker-managed disk volume. Source relation sizes determine archive and restore
budgets (at most32GiB and64GiB), with an8GiB untouched free-space reserve.
Host and Docker filesystem capacity are checked before dumping; the dump has an
OS file-size limit. During restore, disk usage and free space are measured every
2seconds, with a30minute deadline. These are monitored budgets, not filesystem
quotas. Restore failure prevents rollout. Container and volume ownership labels
and inspected absence are required before publishing a verified recovery point;
cleanup failure leaves no verified marker. SIGTERM/SIGINT clean up owned work;
a host crash or SIGKILL requires review of `pagegi.backup-proof=1` leftovers. The receiver requires the PostgreSQL18 client and a fixed
`postgres:18-bookworm` verifier, matching the remote server major version.


Route public hosts to loopback8897 with the original Host header. Provision matching wildcard DNS/TLS for runner hostnames; a certificate for `*.example.test` does not cover `*.runner.example.test`. Validate nginx before reloading and preserve unrelated hosts. Credentials and concrete host topology belong in private provisioning, not committed configuration.

The execution controller also uses the fixed SQL job image
`artefactv2-dataset-sql:<sha>`, built from the release project context with
`src/datasets/sql/container/Dockerfile`. Only execution receives
`PAGEGI_DATASET_SQL_IMAGE`; the application has no Docker socket. Every gated
release builds all four immutable images. Current/previous dataset SQL pointers
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

Before replacing the active composition, the receiver snapshots its exact bytes
under the deployment lock. A failed rollout restores that composition atomically
before recovering the previous app/backend/SQL images; current image pointers and
`.env` stay unchanged. A successful rollout retains `previous-compose.yaml`
beside the previous image pointers. An initial deployment has no prior services
to recover and removes its failed candidate composition. Database backups remain
separate; restoring composition never removes a database or object volume.

Backup retention only owns filenames matching exactly19decimal timestamp digits
followed by `.dump`, inside this deployment's backup directory. Named recovery
backups and symlinks are never deleted. Add `<backup>.dump.protected` to protect
an ordinary timestamp backup; after independently validating a dump with
`pg_restore --list`, record `<backup>.dump.verified` to identify verified recovery
points. Retention always preserves the two newest timestamp backups and the two
newest marked verified backups. It otherwise retains at most7timestamp backups,
and targets16GiB total regular dump bytes (including protected/named backups).
The policy never deletes a protected recovery point to meet either bound; its
aggregate `overBudget` result must be resolved before another rollout/import.
Use `python3 deploy/backup-retention.py <backup-directory>` for a read-only plan;
`--keep` and `--max-bytes` make a separately reviewed capacity budget explicit.
Only `--apply` deletes eligible files. The receiver runs this policy after a
successful deployment, under its deployment lock. Protect migration recovery
points before deploying; retention does not replace an independently verified
pre-import backup or a measured database/WAL/object/image disk budget.

Dataset image attachments use the independent private writable mount
`/opt/artefactv2/dataset-attachments` (UID1000, mode0700). Compose enables
`PAGEGI_DATASET_ATTACHMENT_DIRECTORY=/run/pagegi-dataset-attachments` only in
the app; neither execution nor image jobs mount attachment storage. Deployment
creates the directory without replacing existing contents. It is separate from
imported datasets and media, and remains retained across rollout and rollback.

The sandbox egress hook also drops IPv6 arriving from the dedicated sandbox bridge in the host INPUT and FORWARD chains. This covers kernel link-local addresses even though Docker IPv6 allocation is disabled. The same enabled service reapplies both address families at boot, after Docker restarts, and on deployment; setup refuses if IPv6 rules cannot be installed. Other bridges are unchanged.
