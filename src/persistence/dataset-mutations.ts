import {canonicalMutationReceiptOperation} from "./dataset-receipt-identity.ts";
import { loadDatasetMembers } from "./dataset-members.ts";
import {
  validDatasetMutationParameterMap,
  validDatasetMutationValueParameter,
  validDatasetMutationRowParameters,
} from "../datasets/mutation/parameter-scalars.ts";
import { createHash, randomUUID } from "node:crypto";
import type { SqlClient } from "./sql.ts";
import type {
  DatasetBinding,
  DatasetCallContext,
  DatasetReadAuthority,
} from "../datasets/contracts.ts";
import type {
  DatasetMutationOperation,
  DatasetMutationHead,
} from "../datasets/mutation/contracts.ts";
import {
  DatasetMutationError,
  DATASET_SQL_LIMITS as limits,
} from "../datasets/mutation/contracts.ts";
import type { DatasetMutationRepository } from "../datasets/mutation/repository-contracts.ts";
import type {
  DatasetMutationRepositoryOptions,
  RegisterDatasetOperations,
} from "./dataset-mutation-contracts.ts";
import { canonical } from "../model-values.ts";
import { loadDatasetAuthority } from "./datasets.ts";
import { decodeDatasetBinding } from "./dataset-records.ts";
import { loadGroupAuthority } from "./group-memberships.ts";
import { permissions } from "../access.ts";
import { legacyAudienceReadable } from "../datasets/policy/read.ts";
import { selectDatasetMutationPolicy } from "../datasets/mutation/policy.ts";
import { readRows, projectRow, validateTable } from "../datasets/rows.ts";
import type {
  DatasetColumn,
  MutationOutcome,
} from "../datasets/sql/engine/sql-contracts.ts";
const hash = (value: unknown) =>
  createHash("sha256")
    .update(canonical(value as import("../contracts.ts").Json))
    .digest("hex");
const same = (a: unknown, b: unknown) =>
  canonical(a as import("../contracts.ts").Json) ===
  canonical(b as import("../contracts.ts").Json);
function deny(): never {
  throw new DatasetMutationError("denied");
}
const sameReceiptOperation = (a:unknown,b:DatasetMutationOperation) => {if(!a||typeof a!=="object")return false;const x=canonicalMutationReceiptOperation(a as DatasetMutationOperation),y=canonicalMutationReceiptOperation(b);return x!==null&&y!==null&&same(x,y);};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export const registerDatasetMutationOperations: RegisterDatasetOperations =
  async (client, registrations) => {
    for (const r of registrations) {
      const o = r.operation;
      if (
        !r.sourceNamespace ||
        !r.bindingName ||
        o.receiptIdentity !== undefined ||
        !o.name ||
        o.name.length > 128 ||
        !o.sql ||
        Buffer.byteLength(o.sql) > limits.maxSqlBytes ||
        !Number.isSafeInteger(o.page.version) ||
        o.page.version < 1 ||
        !["refuse", "rerun-fresh"].includes(o.conflictMode) ||
        (o.readsMembers !== undefined && o.readsMembers !== true) ||
        !validDatasetMutationParameterMap(o.paramTypes) ||
        !validDatasetMutationRowParameters(o.rowParams, o.paramTypes) ||
        !validDatasetMutationValueParameter(o.valueParam, o.paramTypes, o.rowParams)
      )
        deny();
      const binding = (
        await client.query(
          "SELECT descriptor,dataset_id,source_namespace FROM dataset_bindings WHERE backend_id=$1 AND backend_version=$2 AND page_id=$3 AND page_version=$4 AND name=$5",
          [
            o.backendId,
            o.backendVersion,
            o.page.id,
            o.page.version,
            r.bindingName,
          ],
        )
      ).rows[0];
      const d = binding?.descriptor as DatasetBinding | undefined;
      if (
        !binding ||
        binding.source_namespace !== r.sourceNamespace ||
        binding.dataset_id !== o.datasetId ||
        !d ||
        d.mode !== "live" ||
        !same(d.page, o.page) ||
        d.backendId !== o.backendId ||
        d.backendVersion !== o.backendVersion
      )
        deny();
      const old = (
        await client.query(
          "SELECT operation,source_namespace,binding_name,dataset_id FROM dataset_mutation_operations WHERE backend_id=$1 AND backend_version=$2 AND page_id=$3 AND page_version=$4 AND name=$5",
          [o.backendId, o.backendVersion, o.page.id, o.page.version, o.name],
        )
      ).rows[0];
      if (old) {
        if (
          !same(old.operation, o) ||
          old.source_namespace !== r.sourceNamespace ||
          old.binding_name !== r.bindingName ||
          old.dataset_id !== o.datasetId
        )
          deny();
        continue;
      }
      await client.query(
        "INSERT INTO dataset_mutation_operations(backend_id,backend_version,page_id,page_version,name,source_namespace,binding_name,dataset_id,operation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",
        [
          o.backendId,
          o.backendVersion,
          o.page.id,
          o.page.version,
          o.name,
          r.sourceNamespace,
          r.bindingName,
          o.datasetId,
          JSON.stringify(o),
        ],
      );
    }
  };
async function registered(
  client: SqlClient,
  context: DatasetCallContext,
  name: string,
  locked = false,
) {
  const row = (
    await client.query(
      `SELECT o.*,b.descriptor,b.dataset_version,v.catalog FROM dataset_mutation_operations o
 JOIN dataset_bindings b ON b.backend_id=o.backend_id AND b.backend_version=o.backend_version AND b.page_id=o.page_id AND b.page_version=o.page_version AND b.name=o.binding_name
 JOIN dataset_versions v ON v.source_namespace=b.source_namespace AND v.legacy_id=b.dataset_id AND v.version=b.dataset_version
 JOIN files f ON f.id=o.page_id AND f.head=o.page_version::text AND f.deleted_at IS NULL
 WHERE o.backend_id=$1 AND o.backend_version=$2 AND o.page_id=$3 AND o.name=$4
 AND o.source_namespace=b.source_namespace AND o.dataset_id=b.dataset_id
 AND EXISTS(SELECT 1 FROM af_page_backends p WHERE p.page_id=o.page_id AND p.page_version=o.page_version AND p.file_id=o.backend_id AND p.version=o.backend_version)${locked ? " FOR SHARE OF f" : ""}`,
      [context.backendId, context.backendVersion, context.pageId, name],
    )
  ).rows[0];
  if (!row) return null;
  const binding = decodeDatasetBinding(row, context, String(row.binding_name)),
    op = row.operation as DatasetMutationOperation;
  if (
    !binding ||
    binding.mode !== "live" ||
    !op ||
    !canonicalMutationReceiptOperation(op) ||
    op.name !== name ||
    op.backendId !== context.backendId ||
    op.backendVersion !== context.backendVersion ||
    op.page?.id !== context.pageId ||
    !same(op.page, binding.page) ||
    op.datasetId !== binding.dataset.id
  )
    return null;
  return {
    row,
    binding,
    operation: op,
    namespace: String(row.source_namespace),
  };
}
type Registration = NonNullable<Awaited<ReturnType<typeof registered>>>;
function tableColumns(
  catalog: unknown,
  tables: DatasetBinding["tables"],
): DatasetMutationHead["tables"] {
  const source =
    object(catalog) && Array.isArray(catalog.tables) ? catalog.tables : [];
  return tables.map((t) => {
    validateTable(t);
    const original = source.find(
      (x) => object(x) && x.schema === t.schema && x.name === t.name,
    );
    return {
      ...t,
      columns: t.columns.map((c) => {
        const raw =
          object(original) && Array.isArray(original.columns)
            ? original.columns.find((x) => object(x) && x.name === c.name)
            : null;
        if (c.type !== "user") return c;
        // Missing original user constraints must not silently turn a constrained field unrestricted.
        if (!object(raw) || raw.type !== "user") deny();
        const constraints = raw.constraints;
        if (
          constraints !== undefined &&
          (!object(constraints) ||
            Object.keys(constraints).some(
              (k) => !["memberOf", "self"].includes(k),
            ) ||
            (constraints.self !== undefined &&
              typeof constraints.self !== "boolean") ||
            (constraints.memberOf !== undefined &&
              (!Array.isArray(constraints.memberOf) ||
                constraints.memberOf.some(
                  (x) =>
                    typeof x !== "string" ||
                    !(x === "current" || /^ref:.+/.test(x)),
                ))))
        )
          deny();
        return {
          ...c,
          ...(constraints === undefined
            ? {}
            : {
                constraints: structuredClone(
                  constraints,
                ) as DatasetColumn["constraints"],
              }),
        };
      }),
    };
  });
}
async function writerReadable(
  client: SqlClient,
  reg: Registration,
  a: DatasetReadAuthority,
  resource: Record<string, unknown>,
  now: number,
): Promise<boolean> {
  const owner = a.page.owner;
  const facts: DatasetReadAuthority["facts"] = {
    caller: owner,
    identity: a.page.ownerIsTestUser ? "testuser" : "user",
    groupRoles: Object.create(null),
    sharedArtifactIds: [],
  };
  if (owner.groupId) return legacyAudienceReadable(a.dataset, facts);
  if (!owner.userId) return false; // Imported token ownership never authenticates a writer.
  const rows = (
    await client.query(
      "SELECT actor,expires_at FROM dataset_principals WHERE source_namespace=$1 AND kind='user' AND legacy_id=$2 FOR SHARE",
      [reg.namespace, owner.userId],
    )
  ).rows;
  if (rows.length !== 1) return false;
  const expiry = rows[0]!.expires_at;
  if (expiry != null && !(new Date(String(expiry)).getTime() > now))
    return false;
  const actor = String(rows[0]!.actor),
    group = await loadGroupAuthority(client, actor);
  const groups = (
    await client.query(
      "SELECT owner,legacy_group_id FROM dataset_groups WHERE source_namespace=$1 AND owner=ANY($2::text[])",
      [reg.namespace, group.memberships.map((x) => x.owner)],
    )
  ).rows;
  const roles: Record<string, "viewer" | "editor"> = Object.create(null);
  for (const row of groups) {
    const m = group.memberships.find((x) => x.owner === row.owner);
    if (m) roles[String(row.legacy_group_id)] = m.role;
  }
  facts.groupRoles = roles;
  const access = resource.access as { shares?: Record<string, string> };
  if (access.shares && Object.hasOwn(access.shares, actor))
    facts.sharedArtifactIds = [a.dataset.id];
  return legacyAudienceReadable(a.dataset, facts);
}
async function currentHead(
  client: SqlClient,
  context: DatasetCallContext,
  reg: Registration,
  now: number,
  write = false,
): Promise<DatasetMutationHead | null> {
  if (context.subject) await loadGroupAuthority(client, context.subject);
  const resource = (
    await client.query(
      "SELECT r.*,a.principal_kind FROM dataset_resources r JOIN accounts a ON a.actor=r.owner WHERE source_namespace=$1 AND legacy_id=$2" +
        (write ? " FOR UPDATE OF r" : " FOR SHARE OF r"),
      [reg.namespace, reg.operation.datasetId],
    )
  ).rows[0];
  if (!resource || resource.deleted) return null;
  const authority = await loadDatasetAuthority(
    client,
    context,
    reg.binding,
    now,
    true,
  );
  if (!authority) return null;
  const members = reg.operation.readsMembers
    ? await loadDatasetMembers(client, context, now)
    : undefined;
  if (reg.operation.readsMembers && !members) return null;
  const version = (
    await client.query(
      "SELECT catalog,source_catalog,unavailable_tables FROM dataset_versions WHERE source_namespace=$1 AND legacy_id=$2 AND version=$3",
      [reg.namespace, reg.operation.datasetId, resource.current_version],
    )
  ).rows[0];
  if (!version || !Array.isArray(version.catalog)) return null;
  const group = context.subject
    ? await loadGroupAuthority(client, context.subject)
    : undefined;
  return {
    authority,
    ...(members ? { members } : {}),
    generation: Number(resource.generation),
    version: Number(resource.current_version),
    policyRevision: Number(resource.policy_revision),
    writable: resource.writable === true,
    callerCanEdit: permissions(
      {
        owner: String(resource.owner),
        ownerKind: resource.principal_kind === "group" ? "group" : "user",
        access: resource.access as import("../contracts.ts").AccessPolicy,
      },
      context.subject,
      true,
      false,
      group,
    ).edit,
    documentWriterCanRead: await writerReadable(
      client,
      reg,
      authority,
      resource,
      now,
    ),
    systemParams: {
      _me__id: authority.facts.caller.userId,
      _now: new Date(now).toISOString(),
      _tz: "UTC",
    },
    tables: tableColumns(
      version.source_catalog,
      version.catalog as DatasetBinding["tables"],
    ),
  };
}

import { validateDatasetUserWrites } from "./dataset-user-writes.ts";
/** All execution receipts are durable. There is intentionally no lease-expiry,
 * execution retry, or reclamation path after an uncertain controller response. */
export function createDatasetMutationRepository({
  database,
  objects,
  now = Date.now,
}: DatasetMutationRepositoryOptions): DatasetMutationRepository {
  return {
    operation: (context, name) =>
      database.transaction(
        async (client) =>
          (await registered(client, context, name))?.operation ?? null,
      ),
    begin: (context, operation, request) =>
      database.transaction(async (client) => {
        // Begin and commit acquire this lock before membership/page/resource/
        // receipt locks, so concurrent replay cannot invert their lock order.
        const peek = await registered(client, context, operation.name);
        if (!peek || !sameReceiptOperation(peek.operation, operation)) deny();
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':dataset-mutations:' || $1,0))",
          [peek.namespace],
        );
        if (context.subject) await loadGroupAuthority(client, context.subject);
        const reg = await registered(client, context, operation.name, true);
        if (!reg || !sameReceiptOperation(reg.operation, operation)) deny();
        const head = await currentHead(client, context, reg, now());
        if (!head) deny();
        selectDatasetMutationPolicy(head, reg.operation);
        const receiptOperation=canonicalMutationReceiptOperation(operation);
        if(!receiptOperation)deny();
        const scope = hash([
          context.subject,
          context.backendId,
          context.backendVersion,
          context.pageId,
          receiptOperation.page.version,
          request.requestId,
        ]);
        const fingerprint = hash([receiptOperation, request]);
        const inserted = await client.query(
          "INSERT INTO dataset_mutation_receipts(scope_key,fingerprint,lease_id,context,operation,request,state,created_at) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,'inflight',$7) ON CONFLICT(scope_key) DO NOTHING",
          [
            scope,
            fingerprint,
            randomUUID(),
            JSON.stringify(context),
            JSON.stringify(receiptOperation),
            JSON.stringify(request),
            now(),
          ],
        );
        const receipt = (
          await client.query(
            "SELECT * FROM dataset_mutation_receipts WHERE scope_key=$1 FOR UPDATE",
            [scope],
          )
        ).rows[0]!;
        if (receipt.fingerprint !== fingerprint)
          throw new DatasetMutationError("request_id_conflict");
        if (receipt.state === "committed")
          return {
            kind: "replay",
            result:
              receipt.result as import("../datasets/mutation/contracts.ts").DatasetMutationResult,
          };
        if (receipt.state === "refused")
          return { kind: "refused", code: String(receipt.refusal) };
        // INSERT's row ownership distinguishes a fresh claim from a prior unknown outcome.
        const fresh = inserted.rowCount === 1;
        return fresh
          ? {
              kind: "lease",
              lease: { id: String(receipt.lease_id), attempt: 1 },
            }
          : { kind: "busy" };
      }),
    head: (context, operation) =>
      database.transaction(async (client) => {
        if (context.subject) await loadGroupAuthority(client, context.subject);
        const reg = await registered(client, context, operation.name, true);
        return reg && sameReceiptOperation(reg.operation, operation)
          ? currentHead(client, context, reg, now())
          : null;
      }),
    async commit(input) {
      const {
        context,
        operation,
        head,
        object: stored,
        outcome,
        lease,
      } = input;
      const target = head.tables.find(
        (t) =>
          t.schema === operation.target.schema &&
          t.name === operation.target.table,
      );
      if (!target) return { kind: "denied" };
      // Verify the exact staged bytes before acquiring DB locks. Metadata alone is not a receipt for a write.
      try {
        if (
          !Array.isArray(outcome.rows) ||
          outcome.rows.length > limits.maxRows ||
          outcome.rows.length * target.columns.length > limits.maxCells ||
          !Number.isSafeInteger(outcome.affected) ||
          outcome.affected < 0 ||
          !same(outcome.columns, target.columns)
        )
          return { kind: "denied" };
        for (const row of outcome.rows) {
          if (
            !object(row) ||
            Object.keys(row).length !== target.columns.length ||
            target.columns.some((c) => !Object.hasOwn(row, c.name))
          )
            return { kind: "denied" };
          projectRow(row, target);
        }
        const rows = await readRows(
          { ...target, object: stored },
          await objects.read(stored.key),
        );
        if (!same(rows, outcome.rows)) return { kind: "denied" };
      } catch {
        return { kind: "denied" };
      }
      return database.transaction(async (client) => {
        // A coarse per-source commit lock avoids cross-dataset user-reference lock
        // cycles; SQL work and object staging happen outside this short transaction.
        const peek = await registered(client, context, operation.name);
        if (!peek || !sameReceiptOperation(peek.operation, operation))
          return { kind: "denied" };
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':dataset-mutations:' || $1,0))",
          [peek.namespace],
        );
        if (context.subject) await loadGroupAuthority(client, context.subject);
        const receipt = (
          await client.query(
            "SELECT * FROM dataset_mutation_receipts WHERE lease_id=$1 AND attempt=$2 FOR UPDATE",
            [lease.id, lease.attempt],
          )
        ).rows[0];
        if (
          !receipt ||
          !same(receipt.context, context) ||
          !sameReceiptOperation(receipt.operation, operation)
        )
          return { kind: "denied" };
        const reg = await registered(client, context, operation.name, true);
        if (!reg || !sameReceiptOperation(reg.operation, operation)) return { kind: "denied" };
        const fresh = await currentHead(client, context, reg, now(), true);
        if (!fresh) return { kind: "denied" };
        let selected;
        try {
          selected = selectDatasetMutationPolicy(fresh, reg.operation);
        } catch {
          return { kind: "denied" };
        }
        if (receipt.state === "committed")
          return {
            kind: "committed",
            result:
              receipt.result as import("../datasets/mutation/contracts.ts").DatasetMutationResult,
          };
        if (receipt.state !== "inflight") return { kind: "denied" };
        if (
          fresh.version !== head.version ||
          fresh.generation !== head.generation ||
          fresh.policyRevision !== head.policyRevision
        )
          return { kind: "conflict" };
        if (
          !outcome.analysis ||
          !selected.operations.includes(outcome.analysis.operation)
        )
          return { kind: "denied" };
        if (
          operation.expectedAffected !== undefined &&
          outcome.affected !== operation.expectedAffected
        )
          return { kind: "denied" };
        // Re-executing against different policy or table metadata would be a hidden rerun.
        if (
          !same(selectDatasetMutationPolicy(head, operation), selected) ||
          !same(head.tables, fresh.tables) ||
          !same(head.members, fresh.members)
        )
          return { kind: "conflict" };
        try {
          await validateDatasetUserWrites(client, reg, fresh, outcome, now());
        } catch (error) {
          if (error instanceof DatasetMutationError) return { kind: "denied" };
          throw error;
        }
        if (
          !Number.isSafeInteger(fresh.version + 1) ||
          !Number.isSafeInteger(fresh.generation + 1)
        )
          return { kind: "denied" };
        const catalog = fresh.tables.map((t) => ({
          schema: t.schema,
          name: t.name,
          columns: t.columns.map(({ name, type }) => ({ name, type })),
          object:
            t.schema === operation.target.schema &&
            t.name === operation.target.table
              ? stored
              : t.object,
        }));
        const previous = (
          await client.query(
            "SELECT source_catalog,unavailable_tables FROM dataset_versions WHERE source_namespace=$1 AND legacy_id=$2 AND version=$3",
            [reg.namespace, operation.datasetId, fresh.version],
          )
        ).rows[0]!;
        const version = fresh.version + 1,
          generation = fresh.generation + 1;
        await client.query(
          "INSERT INTO dataset_versions(source_namespace,legacy_id,version,catalog,source_catalog,unavailable_tables) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)",
          [
            reg.namespace,
            operation.datasetId,
            version,
            JSON.stringify(catalog),
            JSON.stringify(previous.source_catalog),
            JSON.stringify(previous.unavailable_tables),
          ],
        );
        const cas = await client.query(
          "UPDATE dataset_resources SET current_version=$3,generation=$4 WHERE source_namespace=$1 AND legacy_id=$2 AND current_version=$5 AND generation=$6 AND policy_revision=$7 AND NOT deleted",
          [
            reg.namespace,
            operation.datasetId,
            version,
            generation,
            fresh.version,
            fresh.generation,
            fresh.policyRevision,
          ],
        );
        if (cas.rowCount !== 1) throw new DatasetMutationError("row_changed");
        const result = {
          affected: outcome.affected,
          rowCount: outcome.rows.length,
          version,
          generation,
        };
        await client.query(
          "UPDATE dataset_mutation_receipts SET state='committed',result=$2::jsonb,completed_at=$3 WHERE lease_id=$1 AND state='inflight'",
          [lease.id, JSON.stringify(result), now()],
        );
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':dataset-invalidation-sequence',0))",
        );
        await client.query(
          "INSERT INTO dataset_invalidations(source_namespace,dataset_id,version,generation,created_at) VALUES($1,$2,$3,$4,$5)",
          [reg.namespace, operation.datasetId, version, generation, now()],
        );
        return { kind: "committed", result };
      });
    },
    refuse: (lease, code) =>
      database.transaction(async (client) => {
        if (!/^[a-z_]{1,64}$/.test(code))
          throw new DatasetMutationError("invalid_refusal");
        await client.query(
          "UPDATE dataset_mutation_receipts SET state='refused',refusal=$3,completed_at=$4 WHERE lease_id=$1 AND attempt=$2 AND state='inflight'",
          [lease.id, lease.attempt, code, now()],
        );
      }),
  };
}

/** Metadata-only advisory snapshot: no lease, object read, SQL execution or receipt. */
export function createDatasetMutationAvailabilityRepository(database: import('./sql-contracts.ts').SqlDatabase, now=Date.now): import('../datasets/mutation/availability-contracts.ts').DatasetMutationAvailabilityPorts {
 return {snapshot:(context,name,signal)=>database.transaction(async client=>{
  if(context.subject)await loadGroupAuthority(client,context.subject);
  const reg=await registered(client,context,name,true);
  if(!reg)return null;
  const head=await currentHead(client,context,reg,now());
  return head?{operation:reg.operation,head}:null;
 },{timeoutMs:1000,signal})};
}
