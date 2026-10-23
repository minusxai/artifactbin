import { createHash } from "node:crypto";
import type { SqlClient, SqlDatabase } from "./sql-contracts.ts";
import type { DatasetReadService } from "../datasets/contracts.ts";
import type {
  DatasetUserChoiceBinding,
  DatasetUserChoicePorts,
} from "../datasets/user-choices/contracts.ts";
import type {
  UserConstraints,
  UserOption,
} from "../datasets/sql/engine/sql-contracts.ts";
import { createDatasetReadRepository } from "./datasets.ts";
import { loadDocumentHeader } from "./document-records.ts";
import { loadGroupAuthority } from "./group-memberships.ts";
import { authorizePageRead } from "../server/document-authorization.ts";

/** Called only inside the canonical migration publication transaction. */
export async function registerDatasetUserChoiceBindings(
  client: Pick<SqlClient, "query">,
  receipt: {
    backendId: string;
    deployment: { version: string };
    pageId: string;
    pageVersion: number;
  },
  sourceNamespace: string,
  bindings: readonly DatasetUserChoiceBinding[],
): Promise<void> {
  for (const descriptor of bindings) {
    if (
      Object.values(descriptor).some(
        (v) => typeof v !== "string" || !v || v.length > 128,
      ) ||
      Object.keys(descriptor).sort().join() !==
        "bindingName,column,name,schema,sourceColumn,table"
    )
      throw Error("Invalid user choice proof");
    const tuple = [
      receipt.backendId,
      receipt.deployment.version,
      receipt.pageId,
      receipt.pageVersion,
    ];
    const registered = (
      await client.query(
        "SELECT 1 FROM dataset_bindings WHERE backend_id=$1 AND backend_version=$2 AND page_id=$3 AND page_version=$4 AND source_namespace=$5 AND name=$6",
        [...tuple, sourceNamespace, descriptor.bindingName],
      )
    ).rows;
    if (registered.length !== 1) throw Error("Unregistered user choice source");
    const args = [
      ...tuple,
      sourceNamespace,
      descriptor.name,
      descriptor.column,
      JSON.stringify(descriptor),
    ];
    await client.query(
      "INSERT INTO dataset_user_choice_bindings(backend_id,backend_version,page_id,page_version,source_namespace,name,column_name,descriptor) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING",
      args,
    );
    const saved = (
      await client.query(
        "SELECT descriptor=$8::jsonb AS matches FROM dataset_user_choice_bindings WHERE backend_id=$1 AND backend_version=$2 AND page_id=$3 AND page_version=$4 AND source_namespace=$5 AND name=$6 AND column_name=$7",
        args,
      )
    ).rows;
    if (saved.length !== 1 || saved[0]!.matches !== true)
      throw Error("Conflicting user choice proof");
  }
}
/** Source columns and membership references come exclusively from the registered immutable catalog. */
export function createDatasetUserChoiceRepository(
  database: SqlDatabase,
  reads: DatasetReadService,
  now = Date.now,
): DatasetUserChoicePorts {
  const sources = createDatasetReadRepository(database, now);
  return {
    async snapshot(context, request, signal) {
      const registration = await database.transaction(
        async (client) =>
          (
            await client.query(
              `SELECT b.* FROM dataset_user_choice_bindings b JOIN files f ON f.id=b.page_id AND f.head=b.page_version::text AND f.deleted_at IS NULL WHERE b.backend_id=$1 AND b.backend_version=$2 AND b.page_id=$3 AND b.name=$4 AND b.column_name=$5 AND EXISTS(SELECT 1 FROM af_page_backends p WHERE p.page_id=b.page_id AND p.page_version=b.page_version AND p.file_id=b.backend_id AND p.version=b.backend_version)`,
              [
                context.backendId,
                context.backendVersion,
                context.pageId,
                request.name,
                request.column,
              ],
            )
          ).rows,
        { signal, timeoutMs: 1000 },
      );
      if (registration.length !== 1) return null;
      const saved = registration[0]!,
        proof = saved.descriptor as DatasetUserChoiceBinding;
      if (
        !proof ||
        proof.name !== request.name ||
        proof.column !== request.column
      )
        return null;
      // Canonical read service applies source ACL, policy, column visibility and current page authorization.
      const visible = await reads.read(
        context,
        {
          binding: proof.bindingName,
          schema: proof.schema,
          table: proof.table,
          offset: 0,
          limit: 1,
        },
        signal,
      );
      if (
        !visible.columns.some(
          (c) => c.name === proof.sourceColumn && c.type === "user",
        )
      )
        return null;
      const binding = await sources.binding(context, proof.bindingName, signal);
      if (!binding) return null;
      const column = binding.tables
        .find((t) => t.schema === proof.schema && t.name === proof.table)
        ?.columns.find((c) => c.name === proof.sourceColumn);
      if (column?.type !== "user") return null;
      const constraints =
        (column as typeof column & { constraints?: UserConstraints })
          .constraints ?? {};
      if (
        (constraints.memberOf && constraints.memberOf.length > 32) ||
        constraints.memberOf?.some((ref) => !/^ref:[A-Za-z0-9_-]+$/.test(ref))
      )
        return null;
      const authority = await sources.authority(context, binding, signal);
      if (!authority) return null;
      return database.transaction(
        async (client) => {
          const timestamp = now();
          const groupAuthority = context.subject
            ? await loadGroupAuthority(client, context.subject)
            : undefined;
          const session = context.subject
            ? {
                actor: context.subject,
                fileId: null,
                generation: null,
                expires: timestamp + 1,
                groupAuthority,
              }
            : null;
          const ids = new Set<string>(),
            scopeEvidence: unknown[] = [];
          for (const ref of constraints.memberOf ?? []) {
            const legacyId = ref.slice(4);
            const pages = (
              await client.query(
                "SELECT p.page_id,p.snapshot FROM dataset_pages p JOIN files f ON f.id=p.page_id AND f.head=p.page_version::text WHERE p.source_namespace=$1 AND p.snapshot->>'id'=$2 AND f.deleted_at IS NULL LIMIT 2",
                [saved.source_namespace, legacyId],
              )
            ).rows;
            const resources = (
              await client.query(
                "SELECT r.*,a.principal_kind FROM dataset_resources r JOIN accounts a ON a.actor=r.owner WHERE r.source_namespace=$1 AND r.legacy_id=$2 AND NOT r.deleted LIMIT 2",
                [saved.source_namespace, legacyId],
              )
            ).rows;
            // Dataset resources remain canonical when a generated page also represents them.
            if (
              pages.length > 1 ||
              resources.length > 1 ||
              (!pages.length && !resources.length)
            )
              continue;
            const page = pages[0]
              ? await loadDocumentHeader(client, String(pages[0].page_id))
              : null;
            const resource = resources[0];
            const doc = resource
              ? {
                  owner: String(resource.owner),
                  ownerKind:
                    resource.principal_kind === "group"
                      ? ("group" as const)
                      : ("user" as const),
                  generation: Number(resource.generation),
                  shareHash: "",
                  access:
                    resource.access as import("../contracts.ts").AccessPolicy,
                }
              : page;
            if (!doc) continue;
            try {
              authorizePageRead({
                fileId: resource ? legacyId : page!.id,
                document: doc,
                session,
                now: timestamp,
              });
            } catch {
              continue;
            }
            const snapshot = (resource?.snapshot ?? pages[0]?.snapshot) as {
              owner: { userId?: string | null };
            };
            const joins = pages[0]
              ? (
                  await client.query(
                    "SELECT legacy_user_id FROM dataset_page_joins WHERE page_id=$1 AND source_namespace=$2 ORDER BY legacy_user_id LIMIT 1001",
                    [pages[0].page_id, saved.source_namespace],
                  )
                ).rows
              : [];
            if (joins.length > 1000) return null;
            const shares =
              (doc.access as { shares?: Record<string, string> })?.shares ?? {};
            scopeEvidence.push([ref, doc, snapshot, joins]);
            if (snapshot.owner.userId) ids.add(snapshot.owner.userId);
            for (const join of joins) ids.add(String(join.legacy_user_id));
            const sharedActors = Object.keys(shares);
            if (sharedActors.length) {
              const shared = (
                await client.query(
                  "SELECT legacy_id FROM dataset_principals WHERE source_namespace=$1 AND kind='user' AND actor=ANY($2::text[]) AND (expires_at IS NULL OR expires_at>to_timestamp($3::double precision/1000)) ORDER BY legacy_id",
                  [saved.source_namespace, sharedActors, timestamp],
                )
              ).rows;
              for (const p of shared) ids.add(String(p.legacy_id));
            }
            if (ids.size > 1000) return null;
          }
          const callerUserId = authority.facts.caller.userId;
          const wanted = [
            ...new Set([
              ...ids,
              ...(constraints.self && callerUserId ? [callerUserId] : []),
            ]),
          ].sort();
          const rows = wanted.length
            ? (
                await client.query(
                  "SELECT d.legacy_id AS legacy_user_id,p.name,p.handle FROM dataset_principals d JOIN accounts a ON a.actor=d.actor AND a.principal_kind='user' LEFT JOIN dataset_public_profiles p ON p.source_namespace=d.source_namespace AND p.legacy_user_id=d.legacy_id WHERE d.kind='user' AND d.source_namespace=$1 AND d.legacy_id=ANY($2::text[]) AND (d.expires_at IS NULL OR d.expires_at>to_timestamp($3::double precision/1000)) ORDER BY d.legacy_id",
                  [saved.source_namespace, wanted, timestamp],
                )
              ).rows
            : [];
          const options = rows.map((r) => ({
            value: String(r.legacy_user_id),
            label: String(r.name || r.handle || r.legacy_user_id),
          })) as UserOption[];
          const members = options.filter((v) => ids.has(v.value)),
            self = options.find((v) => v.value === callerUserId) ?? null;
          const generation = createHash("sha256")
            .update(
              JSON.stringify([
                saved,
                binding,
                authority,
                scopeEvidence,
                options,
              ]),
            )
            .digest("hex");
          return { generation, constraints, callerUserId, members, self };
        },
        { signal, timeoutMs: 1000 },
      );
    },
  };
}
