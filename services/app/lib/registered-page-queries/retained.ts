import {getDb} from '@/lib/platform';
import {readRegisteredQueryMembers} from './members';
import {resolveDatasetConnection} from '@/lib/datasets/secrets';
import {registeredSourceCatalog} from './source-catalog';
import { SQL_SERVICE_URL } from "@/lib/platform/config";
import { storedRowStats } from "@/lib/datasets/dataset-store";
import { QUERY_LIMITS as limits } from "./contracts";
import { createHash } from "node:crypto";
import type { AccessActor } from "@/lib/accounts";
import { getArtifactById, readableArtifactIdentity, type ArtifactIdentity, type ArtifactRow } from "@/lib/artifacts";
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
  readMembers:(pageId:string)=>Promise<import("@artifactbin/contracts").Row[]>;
  readDocument: typeof getArtifactById;
  /** The reader's admission to the page's head identity (no source, document or metadata body): what a fence rereads. */
  readIdentity: (actor: AccessActor, pageId: string) => Promise<{ row: ArtifactIdentity } | null>;
  readBackend: typeof getHtmlBackendVersion;
  resolveImport: typeof registeredQueryImportForRow;
  readWindow: typeof executeCatalog;
  sourceStats: typeof storedRowStats;
  resolveConnection: typeof resolveDatasetConnection;
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
const stamp = (row: Omit<ArtifactRow, "source" | "document">) =>
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
/** Every identity and access column of a page head and its metadata digest: what a republish or an access change moves. */
const identityKey = (row: ArtifactIdentity) =>
  JSON.stringify([row.id, row.format, row.edit_id, row.version, row.updated_at, row.user_id, row.token_id, row.group_id,
    row.visibility, row.link_role, row.access, row.policy_revision, row.sharing_revision, row.dataset_policy, row.meta_digest]);
/**
 * Simultaneous evaluations of one page (a reader's page load sends one per table) read the same immutable stored
 * dataset revision: they share one window read in flight, keyed by the reader's authority over that exact revision.
 * Nothing outlives the read; each joiner still runs its own fences, and the read is cancelled only when every
 * joiner has gone.
 */
const sharedWindows = new Map<string, { result: Promise<Awaited<ReturnType<typeof executeCatalog>>>; joined: number; controller: AbortController }>();
async function sharedWindow(key: string, signal: AbortSignal, load: (signal: AbortSignal) => ReturnType<typeof executeCatalog>) {
  signal.throwIfAborted();
  let entry = sharedWindows.get(key);
  if (!entry) {
    const controller = new AbortController();
    const created = { joined: 0, controller, result: Promise.resolve().then(() => load(controller.signal)) };
    entry = created;
    sharedWindows.set(key, created);
    created.result.then(() => {}, () => {}).finally(() => { if (sharedWindows.get(key) === created) sharedWindows.delete(key); });
  }
  const joined = entry;
  joined.joined++;
  let leave!: () => void;
  const left = new Promise<never>((_, reject) => {
    leave = () => reject(signal.reason ?? Error("cancelled"));
  });
  left.catch(() => {});
  const onAbort = () => leave();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([joined.result, left]);
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (--joined.joined === 0 && sharedWindows.get(key) === joined) {
      // Settled reads are already gone from the map; an unsettled one nobody waits on is cancelled.
      sharedWindows.delete(key);
      joined.controller.abort(Error("cancelled"));
    }
  }
}
/** Host adapter only: the page's exact saved backend link selects its immutable program. */
export function createRetainedRegisteredQueries(
  actor: AccessActor,
  page: HtmlPageVersion,
  overrides: Partial<RetainedPorts> = {},
) {
  const ports: RetainedPorts = {
    readPage: readHtmlPage,
    readMembers:async pageId=>readRegisteredQueryMembers(await getDb(),pageId,limits.rows+1),
    readDocument: getArtifactById,
    readIdentity: readableArtifactIdentity,
    readBackend: getHtmlBackendVersion,
    resolveImport: registeredQueryImportForRow,
    readWindow: executeCatalog,
    sourceStats: storedRowStats,
    resolveConnection: resolveDatasetConnection,
    execute: (input) => services().sql.run(input),
    now: () => new Date(),
    ...overrides,
  };
  const owned = (input: RunInput) => {
    const sql = services().sql;
    if (!overrides.execute && sql.startRead) return sql.startRead(input);
    if (SQL_SERVICE_URL && !overrides.execute)
      throw Error("registered_query_owned_sql_unavailable");
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
  };
  const runOwned = async (input: RunInput, signal: AbortSignal) => {
    signal.throwIfAborted();
    const handle = owned(input);
    let drain: Promise<void> | undefined;
    const cancel = () => {
      drain ??= handle.cancelAndDrain();
      drain.catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      const result = await handle.result;
      signal.throwIfAborted();
      return result;
    } finally {
      signal.removeEventListener("abort", cancel);
      if (drain) await drain;
    }
  };
  let admittedDocument: ArtifactRow | null = null,
    documentStamp: string | null = null,
    admittedIdentity: string | null = null;
  /** The head's identity and the reader's access, reread: a republish or a lost reader fails the evaluation. */
  const fence = async (signal: AbortSignal) => {
    const head = await ports.readIdentity(actor, page.pageId);
    signal.throwIfAborted();
    if (!head || head.row.format !== "html") throw Error("query_registration_changed");
    return identityKey(head.row);
  };
  /**
   * Admission reads the page and its head in full and compares the served HTML; after that the evaluation holds that
   * row. A `fresh` call (the evaluation's start and end checks and its retained read fences) rereads only the head's
   * identity columns, which move with any republish or access change; reads between them need no page I/O.
   */
  const document = async (signal: AbortSignal, fresh = false) => {
    signal.throwIfAborted();
    if (admittedDocument && admittedIdentity !== null) {
      if (fresh && (await fence(signal)) !== admittedIdentity) throw Error("query_document_changed");
      return admittedDocument;
    }
    const before = await fence(signal);
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
    // The identity read before the full row must still describe it: nothing was republished in between.
    if (JSON.stringify([row.edit_id, row.version, row.updated_at]) !== JSON.stringify(JSON.parse(before).slice(2, 5)))
      throw Error("query_document_changed");
    admittedDocument = row;
    documentStamp = stamp(row);
    admittedIdentity = before;
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
      await document(signal, true);
      return true;
    },
    members:async (_context,signal)=>{
      await document(signal);
      const rows=await ports.readMembers(page.pageId),fingerprint=JSON.stringify(rows);
      signal.throwIfAborted();
      const verify=async(active:AbortSignal)=>{await document(active,true);const current=await ports.readMembers(page.pageId);active.throwIfAborted();if(JSON.stringify(current)!==fingerprint)throw Error('query_members_changed');};
      ports.retainReadFence?.(()=>verify(ports.fenceSignal??new AbortController().signal));
      return {rows,verify};
    },
    platform: async () => ({
      userId: actor.userId,
      now: ports.now().toISOString(),
      tz: "UTC",
    }),
    catalog: async (_context,binding,signal)=>{
      const doc=await document(signal),resolved=await ports.resolveImport(doc,binding,actor);
      signal.throwIfAborted();
      if(resolved.artifact.meta.truncated===true||!['stored','postgres'].includes(resolved.catalog.kind))throw Error('query_source_unsupported');
      const identity=stamp(resolved.artifact);
      const connectionIdentity=async()=>createHash('sha256').update(JSON.stringify(await ports.resolveConnection(resolved.catalog.connection!,actor,resolved.artifact.id))).digest('hex');
      const credential=resolved.catalog.kind==='postgres'?await connectionIdentity():null;
      const verify=async(active:AbortSignal)=>{
        const current=await ports.resolveImport(await document(active,true),binding,actor);
        active.throwIfAborted();
        if(stamp(current.artifact)!==identity||JSON.stringify(current.catalog)!==JSON.stringify(resolved.catalog))throw Error('dataset_changed');
        if(credential!==null&&await connectionIdentity()!==credential)throw Error('dataset_changed');
        active.throwIfAborted();
      };
      ports.retainReadFence?.(()=>verify(ports.fenceSignal??new AbortController().signal));
      return {verify,execute:async(sql,params,paramTypes,active)=>{
        // The evaluator verifies this source before and after each execution; the read itself adds no fence of its own.
        return ports.readWindow(resolved.catalog,sql,params,{limit:limits.rows,offset:0,paramTypes,timeoutMs:5000,actor,datasetId:resolved.artifact.id,signal:active,authorize:async()=>active.throwIfAborted(),execute:input=>runOwned(input,active)});
      }};
    },
    source: async (_context, binding, signal) => {
      const doc = await document(signal),
        resolved = await ports.resolveImport(doc, binding.binding, actor);
      signal.throwIfAborted();
      const prepared=registeredSourceCatalog(resolved.catalog,binding.table,resolved.artifact.meta.truncated);
      const selected=prepared.selected;
      let inputRows=0,inputBytes=0,inputCells=0;
      for(const object of prepared.storedObjects){
        const stats=await ports.sourceStats(object.key,limits.inputBytes);
        signal.throwIfAborted();
        inputRows+=stats.rows;inputBytes+=stats.bytes;inputCells+=stats.rows*object.columns;
        if(inputRows>limits.rows||inputBytes>limits.inputBytes||inputCells>limits.cells)throw Error('query_input_limit');
      }
      const connectionIdentity=async()=>createHash('sha256').update(JSON.stringify(await ports.resolveConnection(prepared.catalog.connection!,actor,resolved.artifact.id))).digest('hex');
      const connectionStamp=prepared.catalog.kind==='postgres'?await connectionIdentity():null;
      signal.throwIfAborted();
      const identity = stamp(resolved.artifact),
        authority = createHash("sha256")
          .update(JSON.stringify([identity, documentStamp, actor]))
          .digest("hex");
      const verify = async (active: AbortSignal) => {
        const currentDoc = await document(active, true);
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
        if(connectionStamp!==null&&await connectionIdentity()!==connectionStamp)throw Error("dataset_changed");
        active.throwIfAborted();
      };
      ports.retainReadFence?.(() =>
        verify(ports.fenceSignal ?? new AbortController().signal),
      );
      let connectedResult:ReturnType<typeof executeCatalog>|undefined;
      return {
        verify,
        read: async (offset, limit, active) => {
          // The evaluator verifies every source once all of its windows are read (and before any answer leaves);
          // the windows themselves are reads of the revision admitted above, so they add no fence of their own.
          active.throwIfAborted();
          const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
          const load = (signal: AbortSignal) => ports.readWindow(
            prepared.catalog,
            `SELECT * FROM ${quote(selected.schema)}.${quote(selected.name)}`,
            {},
            {
              limit:prepared.catalog.kind==='postgres'?limits.rows:limit,
              offset:prepared.catalog.kind==='postgres'?0:offset,
              actor,
              datasetId: resolved.artifact.id,
              signal,
              authorize: async () => signal.throwIfAborted(),
              execute: (input) => runOwned(input, signal),
            },
          );
          // A stored revision is immutable: concurrent evaluations by the same reader share its window read.
          const result=await (prepared.catalog.kind==='postgres'
            ?(connectedResult??=load(active))
            :sharedWindow(JSON.stringify([authority,prepared.catalog,selected,offset,limit]),active,load));
          if(prepared.catalog.kind==='postgres'&&result.truncated)throw Error('query_input_limit');
          const rows=prepared.catalog.kind==='postgres'?result.rows.slice(offset,offset+limit):result.rows;
          return {
            revision: String(resolved.artifact.version),
            authority,
            columns: result.columns,
            rows,
            nextOffset:
              rows.length === limit ? offset + rows.length : null,
          };
        },
      };
    },
    execute: (input, signal) => {
      signal.throwIfAborted();
      return owned(input);
    },
  });
  return {
    execute: async (
      context: QueryContext,
      args: unknown,
      signal: AbortSignal,
    ) => {
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
