import { registerMigrationViewerBinding } from "./viewer-registration.ts";
import { registerDatasetMemberBinding } from "../persistence/dataset-members.ts";
import {
  validDatasetMutationParameterMap,
  validDatasetMutationRowParameters,
} from "../datasets/mutation/parameter-scalars.ts";
import { createHash } from "node:crypto";
import { FILE_ID_ALPHABET, FILE_ID_PATTERN } from "../af-contracts.ts";
import { createBackendHost } from "../backend/container-host.ts";
import { createBackendFiles } from "../backend/af-files.ts";
import {
  digest,
  isCurrentRuntime,
  verifyDeployment,
} from "../backend/deployment.ts";
import { readBackendModule } from "../backend/af-module.ts";
import { generatedDatasetBackendSource } from "./datasets/import-metadata.ts";
import type { CompiledBackend } from "../backend/contracts.ts";
import type {
  MigrationBackendPreparationInput,
  MigrationBackendPreparationPorts,
  MigrationBackendPreparation,
  MigrationBackendReceipt,
  MigrationBackendRegistrar,
} from "./backend-preparation-contracts.ts";
const invalid = (): never => {
  throw new Error("Invalid migration backend preparation");
};
const positive = (n: number) =>
  Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const nonempty = (s: string) =>
  typeof s === "string" &&
  s.length > 0 &&
  s.length <= 1024 &&
  !s.includes("\0");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function candidate(namespace: string, page: string, attempt: number): string {
  const bytes = createHash("sha256")
    .update(JSON.stringify(["dataset-backend-v1", namespace, page, attempt]))
    .digest();
  let number = bytes.readBigUInt64BE(0);
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += FILE_ID_ALPHABET[Number(number % 62n)];
    number /= 62n;
  }
  return id;
}
async function checkedDeployment(deployment: CompiledBackend) {
  try {
    verifyDeployment(deployment);
    if (
      deployment.source !== generatedDatasetBackendSource ||
      !isCurrentRuntime(deployment.runtime) ||
      Object.keys(deployment.lockfile).length ||
      deployment.typeDefs !==
        (await readBackendModule(generatedDatasetBackendSource)).typeDefs
    )
      throw Error();
  } catch {
    throw new Error("Invalid migration backend receipt");
  }
}
/** Offline only. Compile the one fixed source once, outside all destination transactions. */
export async function prepareMigrationBackends(
  input: MigrationBackendPreparationInput,
  ports: MigrationBackendPreparationPorts = {},
): Promise<MigrationBackendPreparation> {
  if (
    !nonempty(input.sourceNamespace) ||
    input.pages.length > 100000 ||
    input.allocatedIds.some((id) => !FILE_ID_PATTERN.test(id))
  )
    invalid();
  let origin: URL;
  try {
    origin = new URL(input.origin);
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.origin !== input.origin
    )
      invalid();
  } catch {
    invalid();
  }
  const allocated = new Set(input.allocatedIds),
    legacyPages = new Set<string>(),
    runtimePages = new Set<string>();
  const pages = [...input.pages].sort((a, b) =>
    a.legacyId.localeCompare(b.legacyId, "en"),
  );
  for (const page of pages) {
    if (
      !nonempty(page.legacyId) ||
      !FILE_ID_PATTERN.test(page.pageId) ||
      !nonempty(page.owner.id) ||
      !["user", "token", "group"].includes(page.owner.kind) ||
      legacyPages.has(page.legacyId) ||
      runtimePages.has(page.pageId)
    )
      invalid();
    legacyPages.add(page.legacyId);
    runtimePages.add(page.pageId);
    allocated.add(page.pageId);
    const versions = new Set<number>();
    for (const revision of page.revisions) {
      if (
        revision.readsViewer !== undefined &&
        (revision.readsViewer !== true ||
          revision.version !==
            Math.max(...page.revisions.map((r) => r.version)))
      )
        invalid();
      if (
        !positive(revision.version) ||
        versions.has(revision.version) ||
        revision.imports.length > 1000
      )
        invalid();
      versions.add(revision.version);
      const names = new Set<string>();
      for (const binding of revision.imports) {
        if (
          !nonempty(binding.name) ||
          binding.name.length > 128 ||
          names.has(binding.name) ||
          !nonempty(binding.legacyRef) ||
          !nonempty(binding.datasetLegacyId) ||
          !positive(binding.datasetVersion)
        )
          invalid();
        names.add(binding.name);
      }
      const operationNames = new Set<string>();
      for (const mutation of revision.mutations ?? []) {
        const binding = revision.imports.find(
          (b) => b.name === mutation.bindingName,
        );
        if (
          !revision.editId ||
          !nonempty(revision.editId) ||
          !binding ||
          binding.datasetLegacyId !== mutation.datasetLegacyId ||
          !/^[A-Za-z][A-Za-z0-9_]*$/.test(mutation.name) ||
          operationNames.has(mutation.name.toLowerCase()) ||
          mutation.conflictMode !== "refuse" ||
          mutation.sqlSchema !== binding.name ||
          !nonempty(mutation.target.schema) ||
          !nonempty(mutation.target.table) ||
          typeof mutation.sql !== "string" ||
          !mutation.sql.length ||
          Buffer.byteLength(mutation.sql) > 64000 ||
          (mutation.expectedAffected !== undefined &&
            (!Number.isSafeInteger(mutation.expectedAffected) ||
              mutation.expectedAffected < 0)) ||
          (mutation.readsMembers !== undefined &&
            mutation.readsMembers !== true) ||
          !validDatasetMutationParameterMap(mutation.paramTypes) ||
          !validDatasetMutationRowParameters(
            mutation.rowParams,
            mutation.paramTypes,
          )
        )
          invalid();
        operationNames.add(mutation.name.toLowerCase());
      }
    }
    if (
      page.owner.kind === "group" &&
      page.revisions.some(
        (r) => r.imports.length || r.readsMembers || r.readsViewer,
      )
    )
      throw new Error(
        "Group-owned pages with dataset Imports cannot use backend execution",
      );
  }
  const required = pages.filter((page) =>
    page.revisions.some(
      (revision) =>
        revision.imports.length ||
        revision.readsMembers ||
        revision.readsViewer,
    ),
  );
  if (!required.length)
    return { receipts: [], bindings: [], operations: [], browserMutations: [] };
  const host =
    ports.host ??
    createBackendHost({
      deploymentNamespace: "afmigration",
      sandboxNetwork: "none",
    });
  let deployment: CompiledBackend;
  try {
    deployment = await host.compile(generatedDatasetBackendSource);
    await checkedDeployment(deployment);
  } finally {
    if (!ports.host) await host.close?.();
  }
  const receipts: MigrationBackendReceipt[] = [],
    bindings: MigrationBackendPreparation["bindings"][number][] = [],
    operations: MigrationBackendPreparation["operations"][number][] = [],
    browserMutations: MigrationBackendPreparation["browserMutations"][number][] =
      [];
  for (const page of required) {
    let backendId = "";
    for (let attempt = 0; attempt < 10000; attempt++) {
      const id = candidate(input.sourceNamespace, page.legacyId, attempt);
      if (!allocated.has(id)) {
        backendId = id;
        allocated.add(id);
        break;
      }
    }
    if (!backendId)
      throw new Error("Migration backend ID allocation exhausted");
    for (const revision of [...page.revisions].sort(
      (a, b) => a.version - b.version,
    )) {
      const readsViewer = revision.readsViewer === true;
      const readsMembers =
        revision.readsMembers ||
        revision.mutations?.some((m) => m.readsMembers);
      receipts.push({
        pageLegacyId: page.legacyId,
        pageId: page.pageId,
        pageVersion: revision.version,
        linked:
          revision.imports.length > 0 || readsMembers === true || readsViewer,
        ...(readsViewer
          ? { viewer: { sourceNamespace: input.sourceNamespace } }
          : {}),
        ...(readsMembers
          ? { members: { sourceNamespace: input.sourceNamespace } }
          : {}),
        owner: page.owner.id,
        backendId,
        backendNamespace: "legacyData",
        backendHref: origin!.origin + "/af/v1/ids/" + backendId,
        sourceSha256: digest(deployment.source),
        bundleSha256: digest(deployment.bundle),
        deployment,
      });
      for (const mutation of revision.mutations ?? []) {
        const {
          bindingName,
          datasetLegacyId,
          reset: _localReset,
          ...authored
        } = mutation;
        const registration = {
          sourceNamespace: input.sourceNamespace,
          bindingName,
          operation: {
            ...authored,
            backendId,
            backendVersion: deployment.version,
            page: {
              id: page.pageId,
              version: revision.version,
              legacyId: page.legacyId,
              editId: revision.editId!,
            },
            datasetId: datasetLegacyId,
          },
        };
        operations.push(registration);
        browserMutations.push({
          pageLegacyId: page.legacyId,
          pageVersion: revision.version,
          mutation: {
            name: mutation.name,
            backendNamespace: "legacyData",
            recoveryScope: digest(
              canonical([
                "dataset-mutation-recovery-v1",
                "legacyData",
                registration,
                mutation.reset ?? [],
              ]),
            ),
            paramTypes: Object.fromEntries(
              Object.entries(mutation.paramTypes).filter(
                ([name]) =>
                  !Object.values(mutation.rowParams ?? {}).some(
                    (row) => row.param === name,
                  ),
              ),
            ),
            ...(mutation.rowParams ? { rowParams: mutation.rowParams } : {}),
            ...(mutation.reset?.length ? { reset: [...mutation.reset] } : {}),
          },
        });
      }
      for (const binding of revision.imports)
        bindings.push({
          pageLegacyId: page.legacyId,
          pageVersion: revision.version,
          pageId: page.pageId,
          backendId,
          backendVersion: deployment.version,
          backendNamespace: "legacyData",
          ...binding,
        });
    }
  }
  return { receipts, bindings, operations, browserMutations };
}
/** The caller owns the page transaction and search_path. This function never begins or commits one. */
export const registerMigrationBackends: MigrationBackendRegistrar = async (
  db,
  receipts,
) => {
  const keys = new Set<string>();
  for (const receipt of receipts) {
    await checkedDeployment(receipt.deployment);
    if (
      !FILE_ID_PATTERN.test(receipt.pageId) ||
      !FILE_ID_PATTERN.test(receipt.backendId) ||
      receipt.pageId === receipt.backendId ||
      !positive(receipt.pageVersion) ||
      typeof receipt.linked !== "boolean" ||
      (receipt.viewer !== undefined &&
        (!receipt.linked || !nonempty(receipt.viewer.sourceNamespace))) ||
      (receipt.members !== undefined &&
        (!receipt.linked || !nonempty(receipt.members.sourceNamespace))) ||
      !nonempty(receipt.owner) ||
      receipt.backendNamespace !== "legacyData" ||
      receipt.sourceSha256 !== digest(receipt.deployment.source) ||
      receipt.bundleSha256 !== digest(receipt.deployment.bundle)
    )
      throw new Error("Invalid migration backend receipt");
    let href: URL;
    try {
      href = new URL(receipt.backendHref);
      if (
        !["http:", "https:"].includes(href.protocol) ||
        href.href !== href.origin + "/af/v1/ids/" + receipt.backendId
      )
        throw Error();
    } catch {
      throw new Error("Invalid migration backend receipt");
    }
    const key = receipt.pageId + ":" + receipt.pageVersion;
    if (keys.has(key)) throw new Error("Duplicate migration backend receipt");
    keys.add(key);
  }
  const client = {
    async query(text: string, values?: readonly unknown[]) {
      const result = await db.query(text, values ? [...values] : undefined);
      return { ...result, rowCount: result.rows.length };
    },
  };
  const files = createBackendFiles({});
  for (const receipt of [...receipts].sort(
    (a, b) => a.pageId.localeCompare(b.pageId) || a.pageVersion - b.pageVersion,
  )) {
    const page = (
      await db.query(
        "SELECT f.owner,a.principal_kind FROM files f JOIN accounts a ON a.actor=f.owner WHERE f.id=$1 FOR UPDATE",
        [receipt.pageId],
      )
    ).rows[0];
    if (!page || page.owner !== receipt.owner || page.principal_kind !== "user")
      throw new Error(
        "Migration backend owner does not match a person-owned page",
      );
    if (!receipt.linked) {
      await files.record(client, {
        owner: receipt.owner,
        pageId: receipt.pageId,
        pageVersion: receipt.pageVersion,
        links: [],
        compiled: {},
      });
      continue;
    }
    if (
      (
        await db.query("SELECT 1 FROM retired_file_ids WHERE id=$1", [
          receipt.backendId,
        ])
      ).rows.length
    )
      throw new Error("Migration backend ID is retired");
    const existing = (
      await db.query(
        "SELECT owner,kind,published FROM file_ids WHERE id=$1 FOR UPDATE",
        [receipt.backendId],
      )
    ).rows[0];
    if (existing) {
      if (
        existing.owner !== receipt.owner ||
        existing.kind !== "backend" ||
        existing.published !== true
      )
        throw new Error("Migration backend ID collision");
      const saved = (
        await db.query(
          "SELECT f.owner,v.page_id,v.deployment FROM af_backend_files f JOIN af_backend_versions v ON v.file_id=f.file_id AND v.version=$2 WHERE f.file_id=$1",
          [receipt.backendId, receipt.deployment.version],
        )
      ).rows[0];
      if (
        !saved ||
        saved.owner !== receipt.owner ||
        saved.page_id !== receipt.pageId ||
        (saved.deployment as CompiledBackend).sourceHash !==
          receipt.sourceSha256
      )
        throw new Error("Migration backend ID collision");
    } else
      await db.query(
        "INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES($1,$2,'backend',true,0)",
        [receipt.backendId, receipt.owner],
      );
    await files.record(client, {
      owner: receipt.owner,
      pageId: receipt.pageId,
      pageVersion: receipt.pageVersion,
      links: receipt.linked
        ? [
            {
              name: receipt.backendNamespace,
              id: receipt.backendId,
              href: receipt.backendHref,
              line: 1,
            },
          ]
        : [],
      compiled: receipt.linked
        ? { [receipt.backendId]: receipt.deployment }
        : {},
    });
    if (receipt.viewer)
      await registerMigrationViewerBinding(db, {
        backendId: receipt.backendId,
        backendVersion: receipt.deployment.version,
        pageId: receipt.pageId,
        pageVersion: receipt.pageVersion,
        sourceNamespace: receipt.viewer.sourceNamespace,
      });
    if (receipt.members)
      await registerDatasetMemberBinding(client, {
        backendId: receipt.backendId,
        backendVersion: receipt.deployment.version,
        pageId: receipt.pageId,
        pageVersion: receipt.pageVersion,
        sourceNamespace: receipt.members.sourceNamespace,
      });
  }
};
