import { loadDocumentHeader, loadSession } from "./document-records.ts";
import { authorizeDocument } from "../server/document-authorization.ts";
import { createHash, randomBytes } from "node:crypto";
import type { SqlClient } from "./sql-contracts.ts";
import type {
  DatasetAttachmentAuthority,
  DatasetAttachmentContext,
  DatasetAttachmentRegistration,
  DatasetAttachmentRepository,
  DatasetAttachmentRecord,
} from "../datasets/attachments/contracts.ts";
import {
  DATASET_ATTACHMENT_LIMITS,
  DatasetAttachmentError,
} from "../datasets/attachments/contracts.ts";
import type {
  DatasetAttachmentRepositoryOptions,
  RegisterDatasetAttachments,
} from "./dataset-attachment-contracts.ts";
import { loadDatasetAuthority } from "./datasets.ts";
import { loadGroupAuthority } from "./group-memberships.ts";
import { datasetAttachmentAllowed } from "../datasets/attachments/policy.ts";
function canonical(v: unknown): unknown {
  return Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
        )
      : v;
}
const hash = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
function deny(): never {
  throw new DatasetAttachmentError("denied");
}
async function registration(
  client: SqlClient,
  c: DatasetAttachmentContext,
): Promise<DatasetAttachmentRegistration | null> {
  const rows = (
    await client.query(
      `SELECT a.registration FROM dataset_attachment_bindings a JOIN files f ON f.id=a.page_id AND f.head=a.page_version::text AND f.deleted_at IS NULL
 WHERE a.backend_id=$1 AND a.backend_version=$2 AND a.page_id=$3 AND a.name=$4 AND a.backend_namespace=$5
 AND EXISTS(SELECT 1 FROM af_page_backends p WHERE p.page_id=a.page_id AND p.page_version=a.page_version AND p.file_id=a.backend_id AND p.version=a.backend_version AND p.name=a.backend_namespace)`,
      [
        c.backendId,
        c.backendVersion,
        c.pageId,
        c.bindingName,
        c.backendNamespace,
      ],
    )
  ).rows;
  return rows.length === 1
    ? (rows[0]!.registration as DatasetAttachmentRegistration)
    : null;
}
async function authority(
  client: SqlClient,
  c: DatasetAttachmentContext,
  now: number,
): Promise<DatasetAttachmentAuthority | null> {
  const reg = await registration(client, c);
  if (!reg) return null;
  const session = c.credentialHash
    ? await loadSession(client, c.credentialHash)
    : null;
  try {
    const decision = authorizeDocument({
      document: await loadDocumentHeader(client, c.pageId),
      session,
      credentialHash: c.credentialHash,
      fileId: c.pageId,
      now,
    });
    if (decision.actor !== c.subject) return null;
  } catch {
    return null;
  }
  const a = await loadDatasetAuthority(client, c, reg.binding, now, true);
  if (!a) return null;
  return { registration: reg, authority: a, generation: hash([reg, a]) };
}
function record(row: Record<string, unknown>): DatasetAttachmentRecord {
  return {
    id: String(row.id),
    sourceNamespace: String(row.source_namespace),
    datasetId: String(row.dataset_id),
    pageId: String(row.page_id),
    object: row.object as DatasetAttachmentRecord["object"],
  };
}
/** Registry publication is in the exact saved-page transaction and cannot silently replace an earlier registration. */
export async function registerDatasetAttachments({
  client,
  registrations,
}: RegisterDatasetAttachments): Promise<void> {
  for (const r of registrations) {
    const b = r.binding;
    if (
      b.mode !== "live" ||
      !r.acceptedTypes.length ||
      r.acceptedTypes.some(
        (t) => !["image/png", "image/jpeg", "image/webp"].includes(t),
      )
    )
      deny();
    const rows = (
      await client.query(
        `SELECT b.descriptor FROM dataset_bindings b JOIN files f ON f.id=b.page_id AND f.head=b.page_version::text AND f.deleted_at IS NULL
   WHERE b.backend_id=$1 AND b.backend_version=$2 AND b.page_id=$3 AND b.page_version=$4 AND b.name=$5 AND b.source_namespace=$6
   AND EXISTS(SELECT 1 FROM af_page_backends p WHERE p.page_id=b.page_id AND p.page_version=b.page_version AND p.file_id=b.backend_id AND p.version=b.backend_version AND p.name=$7)`,
        [
          b.backendId,
          b.backendVersion,
          b.page.id,
          b.page.version,
          b.name,
          r.sourceNamespace,
          r.backendNamespace,
        ],
      )
    ).rows;
    if (rows.length !== 1) deny();
    const saved = rows[0]!.descriptor as typeof b;
    const { tables: _tables, ...descriptor } = b;
    if (hash(saved) !== hash(descriptor)) deny();
    await client.query(
      `INSERT INTO dataset_attachment_bindings(backend_id,backend_version,page_id,page_version,name,backend_namespace,source_namespace,registration) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [
        b.backendId,
        b.backendVersion,
        b.page.id,
        b.page.version,
        b.name,
        r.backendNamespace,
        r.sourceNamespace,
        JSON.stringify(r),
      ],
    );
    const existing = await registration(client, {
      backendId: b.backendId,
      backendVersion: b.backendVersion,
      pageId: b.page.id,
      subject: null,
      credentialHash: null,
      bindingName: b.name,
      backendNamespace: r.backendNamespace,
    });
    if (!existing || hash(existing) !== hash(r)) deny();
  }
}
/** The namespace mutation lock is shared with dataset writes; membership→resource→page lock order stays consistent. */
export function createDatasetAttachmentRepository({
  database,
  now = Date.now,
  newId = () => randomBytes(16).toString("hex"),
}: DatasetAttachmentRepositoryOptions): DatasetAttachmentRepository {
  return {
    authority: (c, signal) =>
      database.transaction((client) => authority(client, c, now()), {
        signal,
        timeoutMs: 1000,
      }),
    async commit(input, signal) {
      const { context: c, initial, staged, request } = input;
      if (!c.subject) deny();
      const ns = initial.registration.sourceNamespace;
      async function freshLocked(client: SqlClient) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':dataset-mutations:' || $1,0))",
          [ns],
        );
        await loadGroupAuthority(client, c.subject!);
        const rows = (
          await client.query(
            "SELECT legacy_id FROM dataset_resources WHERE source_namespace=$1 AND legacy_id=$2 AND NOT deleted FOR UPDATE",
            [ns, initial.registration.binding.dataset.id],
          )
        ).rows;
        if (rows.length !== 1) deny();
        const fresh = await authority(client, c, now());
        if (
          !fresh ||
          fresh.generation !== initial.generation ||
          !datasetAttachmentAllowed(c, fresh, "insert") ||
          !fresh.registration.acceptedTypes.includes(request.contentType) ||
          !fresh.registration.acceptedTypes.includes(staged.object.contentType)
        )
          deny();
        return fresh;
      }
      const reserved = await database.transaction(
        async (client) => {
          const fresh = await freshLocked(client),
            datasetId = fresh.registration.binding.dataset.id;
          const fingerprint = hash([
            c.pageId,
            fresh.registration.binding.page.version,
            c.backendId,
            c.backendVersion,
            c.backendNamespace,
            c.bindingName,
            staged.inputSha256,
            request.filename,
            request.contentType,
          ]);
          const receipts = (
            await client.query(
              "SELECT fingerprint,attachment_id FROM dataset_attachment_receipts WHERE source_namespace=$1 AND dataset_id=$2 AND actor=$3 AND request_id=$4",
              [ns, datasetId, c.subject, request.requestId],
            )
          ).rows;
          if (receipts.length) {
            if (receipts[0]!.fingerprint !== fingerprint)
              throw new DatasetAttachmentError("conflict");
            const found = (
              await client.query(
                "SELECT a.*,c.attachment_id IS NOT NULL AS completed FROM dataset_attachments a LEFT JOIN dataset_attachment_completions c ON c.attachment_id=a.id WHERE a.id=$1",
                [receipts[0]!.attachment_id],
              )
            ).rows[0];
            if (!found) deny();
            // Recovery may never substitute outputs from a different codec revision.
            if (!found.completed && hash(found.object) !== hash(staged.object))
              throw new DatasetAttachmentError("conflict");
            return {
              record: record(found),
              replayed: true,
              completed: !!found.completed,
            };
          }
          const bytes = staged.object.totalBytes ?? staged.object.byteLength;
          if (
            !Number.isSafeInteger(bytes) ||
            bytes <= 0 ||
            bytes > DATASET_ATTACHMENT_LIMITS.datasetBytes
          )
            throw new DatasetAttachmentError("too_large");
          const q = (
            await client.query(
              "SELECT count(*) AS files,coalesce(sum(stored_bytes),0) AS bytes FROM dataset_attachments WHERE source_namespace=$1 AND dataset_id=$2",
              [ns, datasetId],
            )
          ).rows[0]!;
          if (
            Number(q.files) >= DATASET_ATTACHMENT_LIMITS.datasetFiles ||
            Number(q.bytes) + bytes > DATASET_ATTACHMENT_LIMITS.datasetBytes
          )
            throw new DatasetAttachmentError("quota");
          const fileId = newId();
          if (!/^[a-f0-9]{32}$/.test(fileId))
            throw new DatasetAttachmentError("unavailable");
          await client.query(
            "INSERT INTO dataset_attachments(id,source_namespace,dataset_id,page_id,object,stored_bytes) VALUES($1,$2,$3,$4,$5,$6)",
            [
              fileId,
              ns,
              datasetId,
              c.pageId,
              JSON.stringify(staged.object),
              bytes,
            ],
          );
          await client.query(
            "INSERT INTO dataset_attachment_receipts(source_namespace,dataset_id,actor,request_id,fingerprint,attachment_id) VALUES($1,$2,$3,$4,$5,$6)",
            [ns, datasetId, c.subject, request.requestId, fingerprint, fileId],
          );
          return {
            record: {
              id: fileId,
              sourceNamespace: ns,
              datasetId,
              pageId: c.pageId,
              object: staged.object,
            },
            replayed: false,
            completed: false,
          };
        },
        { signal, timeoutMs: 1000 },
      );
      if (reserved.completed)
        return { record: reserved.record, replayed: true };
      // Every promoted byte already has durable quota accounting. Unknown failures retain the charged reservation.
      signal?.throwIfAborted();
      await staged.publish();
      signal?.throwIfAborted();
      await database.transaction(
        async (client) => {
          await freshLocked(client);
          await client.query(
            "INSERT INTO dataset_attachment_completions(attachment_id) VALUES($1) ON CONFLICT DO NOTHING",
            [reserved.record.id],
          );
        },
        { signal, timeoutMs: 1000 },
      );
      return { record: reserved.record, replayed: reserved.replayed };
    },
    read: (c, id, signal) =>
      database.transaction(
        async (client) => {
          const a = await authority(client, c, now());
          if (!a || !datasetAttachmentAllowed(c, a, "read")) return null;
          const rows = (
            await client.query(
              "SELECT a.* FROM dataset_attachments a JOIN dataset_attachment_completions c ON c.attachment_id=a.id WHERE a.id=$1 AND a.source_namespace=$2 AND a.dataset_id=$3 AND a.page_id=$4",
              [
                id,
                a.registration.sourceNamespace,
                a.registration.binding.dataset.id,
                c.pageId,
              ],
            )
          ).rows;
          return rows.length === 1
            ? { record: record(rows[0]!), generation: a.generation }
            : null;
        },
        { signal, timeoutMs: 1000 },
      ),
  };
}
