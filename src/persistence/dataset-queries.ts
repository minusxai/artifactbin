import { assertSavedProgramRegistration } from "../programs/registration.ts";
import { verifyDeployment } from "../backend/deployment.ts";
import type { CompiledBackend } from "../backend/contracts.ts";
import { sourceDigest } from "../server/page-ports.ts";
import type { SqlClient, SqlDatabase } from "./sql.ts";
import type {
  SavedQueryRegistration,
  SavedQueryInvocation,
  SavedQueryAuthority,
} from "./dataset-queries-contracts.ts";
import { loadDocumentHeader, loadSession } from "./document-records.ts";
import { authorizePageRead } from "../server/document-authorization.ts";
/** Only an offline trusted compiler/importer calls this transaction port. Never upsert source metadata. */
export async function registerSavedQueries(
  client: SqlClient,
  value: SavedQueryRegistration,
): Promise<void> {
  const v = structuredClone(value),
    r = v.plan.registration;
  if (
    !/^[a-f0-9]{64}$/.test(r.sourceSha256) ||
    !/^[a-f0-9]{64}$/.test(v.moduleSourceSha256) ||
    !v.sourceNamespace
  )
    throw Error("query_registration_invalid");
  assertSavedProgramRegistration(v);
  for (const name of v.program?.manifest.mutations ?? []) {
    const operations = await client.query(
      "SELECT 1 FROM dataset_mutation_operations WHERE backend_id=$1 AND backend_version=$2 AND page_id=$3 AND page_version=$4 AND name=$5 AND source_namespace=$6",
      [
        r.backendId,
        r.backendVersion,
        r.pageId,
        r.pageVersion,
        name,
        v.sourceNamespace,
      ],
    );
    if (operations.rows.length !== 1)
      throw Error("program_operation_registration_unavailable");
  }
  const source = (
    await client.query(
      `SELECT s.content FROM sources s
    JOIN af_page_backends p ON p.page_id=s.file_id AND p.page_version::text=s.revision
    JOIN af_backend_versions b ON b.file_id=p.file_id AND b.version=p.version
    WHERE s.file_id=$1 AND s.revision=$2::text AND s.digest=$3 AND p.file_id=$4 AND p.version=$5`,
      [r.pageId, r.pageVersion, r.sourceSha256, r.backendId, r.backendVersion],
    )
  ).rows;
  if (
    source.length !== 1 ||
    sourceDigest(String(source[0]!.content)) !==
      r.sourceSha256
  )
    throw Error("query_registration_source_mismatch");
  for (const binding of new Set(v.plan.imports.map((i) => i.read.binding))) {
    const rows = (
      await client.query(
        `SELECT 1 FROM dataset_bindings WHERE backend_id=$1 AND backend_version=$2 AND page_id=$3 AND page_version=$4 AND name=$5 AND source_namespace=$6`,
        [
          r.backendId,
          r.backendVersion,
          r.pageId,
          r.pageVersion,
          binding,
          v.sourceNamespace,
        ],
      )
    ).rows;
    if (rows.length !== 1) throw Error("query_registration_binding_mismatch");
  }
  const parameters = [
    r.backendId,
    r.backendVersion,
    r.pageId,
    r.pageVersion,
    r.sourceSha256,
    v.sourceNamespace,
    v,
  ];
  await client.query(
    `INSERT INTO dataset_query_registrations(backend_id,backend_version,page_id,page_version,source_sha256,source_namespace,registration) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
    parameters,
  );
  const saved = (
    await client.query(
      `SELECT 1 FROM dataset_query_registrations WHERE backend_id=$1 AND backend_version=$2 AND page_id=$3 AND page_version=$4 AND source_sha256=$5 AND source_namespace=$6 AND registration=$7::jsonb`,
      parameters,
    )
  ).rows;
  if (saved.length !== 1) throw Error("query_registration_conflict");
}
/** A last-check authorization boundary, not a policy lock spanning remote SQL. No result is released before the final check. */
export function createSavedQueryRepository(
  database: SqlDatabase,
  now = Date.now,
) {
  return {
    resolve(
      invocation: SavedQueryInvocation,
      signal: AbortSignal,
    ): Promise<SavedQueryAuthority | null> {
      const i = structuredClone(invocation);
      return database.transaction(
        async (client) => {
          if (i.principal.tenant !== i.pageId) return null;
          const session =
            i.tokenHash === null
              ? null
              : await loadSession(client, i.tokenHash);
          if (
            (i.tokenHash !== null && !session) ||
            (session?.actor ?? null) !== i.principal.subject
          )
            return null;
          const row = (
            await client.query(
              `SELECT q.registration,s.content,s.digest,b.deployment FROM dataset_query_registrations q
    JOIN files f ON f.id=q.page_id AND f.head=q.page_version::text AND f.deleted_at IS NULL AND f.source_digest=q.source_sha256
    JOIN sources s ON s.file_id=q.page_id AND s.revision=q.page_version::text AND s.digest=q.source_sha256
    JOIN af_page_backends p ON p.page_id=q.page_id AND p.page_version=q.page_version AND p.file_id=q.backend_id AND p.version=q.backend_version
    JOIN af_backend_versions b ON b.file_id=q.backend_id AND b.version=q.backend_version
    WHERE q.page_id=$1 AND q.backend_id=$2 AND q.backend_version=$3 FOR SHARE OF f,s,p,b,q`,
              [i.pageId, i.backendId, i.backendVersion],
            )
          ).rows;
          if (row.length !== 1) return null;
          const page = await loadDocumentHeader(client, i.pageId);
          if (!page) return null;
          try {
            authorizePageRead({
              document: page,
              session,
              fileId: i.pageId,
              now: now(),
            });
          } catch {
            return null;
          }
          const record = row[0]!;
          try {
            verifyDeployment(record.deployment as CompiledBackend);
          } catch {
            return null;
          }
          const registration = record.registration as SavedQueryRegistration,
            r = registration.plan.registration;
          if (
            registration.program?.native &&
            (page.ownerKind !== "user" ||
              !session?.actor ||
              page.owner !== session.actor)
          )
            return null;
          if (
            r.pageId !== i.pageId ||
            r.backendId !== i.backendId ||
            r.backendVersion !== i.backendVersion ||
            String(r.pageVersion) !== page.head ||
            r.sourceSha256 !== record.digest ||
            sourceDigest(String(record.content)) !== r.sourceSha256 ||
            (record.deployment as { version?: unknown })?.version !==
              i.backendVersion
          )
            return null;
          const account = i.principal.subject
            ? (
                await client.query(
                  "SELECT 1 FROM accounts WHERE actor=$1 AND principal_kind='user'",
                  [i.principal.subject],
                )
              ).rows
            : [];
          if (i.principal.subject && account.length !== 1) return null;
          const mappings = i.principal.subject
            ? (
                await client.query(
                  "SELECT legacy_id,identity,expires_at FROM dataset_principals WHERE source_namespace=$1 AND actor=$2 AND kind='user' FOR SHARE",
                  [registration.sourceNamespace, i.principal.subject],
                )
              ).rows
            : [];
          if (
            mappings.length > 1 ||
            (i.principal.subject && mappings.length !== 1)
          )
            return null;
          if (
            mappings[0] &&
            (!(
              mappings[0].identity === "user" ||
              mappings[0].identity === "testuser"
            ) ||
              typeof mappings[0].legacy_id !== "string" ||
              !mappings[0].legacy_id ||
              mappings[0].legacy_id.length > 512)
          )
            return null;
          if (mappings[0]?.expires_at != null) {
            const expiry = new Date(String(mappings[0].expires_at)).getTime();
            if (!Number.isFinite(expiry) || expiry <= now()) return null;
          }
          return {
            context: { ...r, subject: i.principal.subject },
            registration,
            userId: mappings.length ? String(mappings[0]!.legacy_id) : null,
          };
        },
        { signal, timeoutMs: 1000 },
      );
    },
  };
}
