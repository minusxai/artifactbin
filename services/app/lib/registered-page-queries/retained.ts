import { SQL_SERVICE_URL } from "@/lib/platform/config";
import { storedRowStats } from "@/lib/datasets/dataset-store";
import { QUERY_LIMITS as limits } from "./contracts";
import { createHash } from "node:crypto";
import type { AccessActor } from "@/lib/accounts";
import { getArtifactById, type ArtifactRow } from "@/lib/artifacts";
import { readHtmlPage } from "@/lib/html-publication";
import { getHtmlBackendVersion } from "@/lib/html-backends";
import { registeredQueryImportForRow } from "@/lib/document-data";
import { executeCatalog } from "@/lib/datasets/execute";
import { services } from "@/lib/platform";
import type {
  HtmlPageVersion,
  RunInput,
  QueryOutcome,
} from "@artifactbin/contracts";
import { createRegisteredPageQueries } from "./service";
import { pageSourceDigest, registeredPlan } from "./registry";
import type { QueryContext } from "./contracts";
interface RetainedPorts {
  readPage: typeof readHtmlPage;
  readDocument: typeof getArtifactById;
  readBackend: typeof getHtmlBackendVersion;
  resolveImport: typeof registeredQueryImportForRow;
  readWindow: typeof executeCatalog;
  sourceStats: typeof storedRowStats;
  execute: (input: RunInput) => Promise<Record<string, QueryOutcome>>;
  now: () => Date;
  fenceSignal?: AbortSignal;
  retainReadFence?: (verify: () => Promise<void>) => void;
}
/** Includes owner/visibility/policy, source revision, and complete source metadata (catalog/object identities). */
const linkStamp = (links: HtmlPageVersion["links"]) =>
  JSON.stringify(
    links.map((link) =>
      Object.fromEntries(
        Object.entries(link).sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
  );
const stamp = (row: ArtifactRow) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        row.id,
        row.edit_id,
        row.version,
        row.user_id,
        row.group_id,
        row.visibility,
        row.policy_revision,
        row.sharing_revision,
        row.dataset_policy,
        row.meta,
      ]),
    )
    .digest("hex");
/** Host adapter only: the page's exact saved backend link selects its immutable program. */
export function createRetainedRegisteredQueries(
  actor: AccessActor,
  page: HtmlPageVersion,
  overrides: Partial<RetainedPorts> = {},
) {
  const ports: RetainedPorts = {
    readPage: readHtmlPage,
    readDocument: getArtifactById,
    readBackend: getHtmlBackendVersion,
    resolveImport: registeredQueryImportForRow,
    readWindow: executeCatalog,
    sourceStats: storedRowStats,
    execute: (input) => services().sql.run(input),
    now: () => new Date(),
    ...overrides,
  };
  let admittedDocument: ArtifactRow | null = null,
    documentStamp: string | null = null;
  const document = async (signal: AbortSignal) => {
    signal.throwIfAborted();
    const readable = await ports.readPage(actor, page.pageId, page.revision);
    const row = await ports.readDocument(page.pageId);
    signal.throwIfAborted();
    if (
      !row ||
      row.format !== "html" ||
      readable.version !== page.version ||
      readable.html !== page.html ||
      linkStamp(readable.links) !== linkStamp(page.links)
    )
      throw Error("query_registration_changed");
    if (documentStamp !== null && stamp(row) !== documentStamp)
      throw Error("query_document_changed");
    admittedDocument ??= row;
    documentStamp ??= stamp(row);
    return row;
  };
  const evaluator = createRegisteredPageQueries({
    registry: async (context, signal) => {
      await document(signal);
      const link = page.links.find(
        (link) =>
          link.kind === "backend" &&
          link.backendId === context.backendId &&
          link.version === context.backendVersion,
      );
      if (!link || link.kind !== "backend")
        throw Error("query_registration_changed");
      const backend = await ports.readBackend(link.backendId, link.version);
      if (!backend || backend.ownerId !== admittedDocument?.user_id)
        throw Error("query_registration_changed");
      const plan = registeredPlan(page, link, backend);
      if (!plan) throw Error("query_registration_changed");
      return plan;
    },
    authorize: async (context, _identity, signal) => {
      if (context.subject !== actor.userId) return false;
      await document(signal);
      return true;
    },
    platform: async () => ({
      userId: actor.userId,
      now: ports.now().toISOString(),
      tz: "UTC",
    }),
    source: async (_context, binding, signal) => {
      const doc = await document(signal),
        resolved = await ports.resolveImport(doc, binding.binding, actor);
      signal.throwIfAborted();
      if (
        resolved.catalog.kind !== "stored" ||
        resolved.catalog.tables.some((table) => table.sql !== undefined) ||
        resolved.artifact.meta.truncated === true
      )
        throw Error("query_source_unsupported");
      const matches = resolved.catalog.tables.filter(
        (table) =>
          table.name === binding.table &&
          table.schema === resolved.catalog.defaultSchema,
      );
      if (matches.length !== 1 || !matches[0]!.objectKey)
        throw Error("query_source_unsupported");
      const selected = matches[0]!;
      const stats = await ports.sourceStats(
        selected.objectKey!,
        limits.inputBytes,
      );
      signal.throwIfAborted();
      if (
        stats.rows > limits.rows ||
        stats.bytes > limits.inputBytes ||
        stats.rows * selected.columns.length > limits.cells
      )
        throw Error("query_input_limit");
      const identity = stamp(resolved.artifact),
        authority = createHash("sha256")
          .update(JSON.stringify([identity, documentStamp, actor]))
          .digest("hex");
      const verify = async (active: AbortSignal) => {
        const currentDoc = await document(active);
        const current = await ports.resolveImport(
          currentDoc,
          binding.binding,
          actor,
        );
        active.throwIfAborted();
        if (
          stamp(current.artifact) !== identity ||
          JSON.stringify(current.catalog) !== JSON.stringify(resolved.catalog)
        )
          throw Error("dataset_changed");
      };
      ports.retainReadFence?.(() =>
        verify(ports.fenceSignal ?? new AbortController().signal),
      );
      return {
        verify,
        read: async (offset, limit, active) => {
          await verify(active);
          const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
          const result = await ports.readWindow(
            { ...resolved.catalog, tables: [selected] },
            `SELECT * FROM ${quote(selected.schema)}.${quote(selected.name)}`,
            {},
            {
              limit,
              offset,
              actor,
              datasetId: resolved.artifact.id,
              signal: active,
              authorize: () => verify(active),
            },
          );
          await verify(active);
          return {
            revision: String(resolved.artifact.version),
            authority,
            columns: result.columns,
            rows: result.rows,
            nextOffset:
              result.rows.length === limit ? offset + result.rows.length : null,
          };
        },
      };
    },
    execute: (input, signal) => {
      signal.throwIfAborted();
      const result = ports.execute(input);
      return {
        result,
        cancelAndDrain: async () => {
          await result.then(
            () => {},
            () => {},
          );
        },
      };
    },
  });
  return {
    execute: async (
      context: QueryContext,
      args: unknown,
      signal: AbortSignal,
    ) => {
      // HTTP timeout is not proof that a remote SQL job stopped. The initial adapter
      // requires the local host pool's completion; a future transport needs a real drain receipt.
      if (SQL_SERVICE_URL && !overrides.execute)
        throw Error("registered_query_remote_drain_unavailable");
      if (
        context.pageId !== page.pageId ||
        context.pageVersion !== page.version ||
        context.sourceSha256 !== pageSourceDigest(page.html)
      )
        throw Error("query_registration_changed");
      return evaluator.execute(context, args, signal);
    },
  };
}
