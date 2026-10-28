import { buildSchema } from "graphql";
import { createHash } from "node:crypto";
import type {
  HtmlBackendLink,
  HtmlPageVersion,
  Queryable,
} from "@artifactbin/contracts";
import type { HtmlBackendVersionRecord } from "@/lib/html-backends";
import type { QueryPlan } from "./contracts";
import { prepare } from "./model";
import { registeredQuerySchema } from "./namespace";
export type RegisteredQueryProgram = Omit<QueryPlan, "registration">;
interface Envelope {
  kind: "registered-page-queries-v1";
  pageId: string;
  pageVersion: number;
  sourceSha256: string;
  provenance: {
    compilerSha256: string;
    sourceSha256: string;
    sqlEngineSha256: string;
  };
  program: RegisteredQueryProgram;
  digest: string;
}
const PREFIX = "!registered-page-queries-v1\n";
export const pageSourceDigest = (html: string) =>
  createHash("sha256").update(html).digest("hex");
const digest = (value: unknown) => pageSourceDigest(JSON.stringify(value));
function contentVersion(source: string, typeDefs: string, compiled: string) {
  return digest([source, typeDefs, compiled, []]);
}
/** Trusted host preparation only: this object is never accepted by the public backend compiler.
 * Its compiled envelope begins with invalid JavaScript. The ordinary compiler always emits its own JS wrapper. */
export function prepareRegisteredQueryBackend(
  name: string,
  backendId: string,
  page: Pick<HtmlPageVersion, "pageId" | "version" | "html">,
  program: RegisteredQueryProgram,
  provenance: Envelope["provenance"],
) {
  if (
    !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(backendId) ||
    !Number.isSafeInteger(page.version) ||
    page.version < 1 ||
    ![
      provenance.compilerSha256,
      provenance.sourceSha256,
      provenance.sqlEngineSha256,
    ].every((v) => /^[a-f0-9]{64}$/.test(v))
  )
    throw Error("invalid_query_registration");
  const snapshot = structuredClone(program);
  prepare(
    {
      ...snapshot,
      registration: {
        pageId: page.pageId,
        pageVersion: page.version,
        backendId,
        backendVersion: "pending",
        sourceSha256: pageSourceDigest(page.html),
      },
    },
    { values: {}, only: [] },
  );
  const body = {
    kind: "registered-page-queries-v1" as const,
    pageId: page.pageId,
    pageVersion: page.version,
    sourceSha256: pageSourceDigest(page.html),
    provenance: structuredClone(provenance),
    program: snapshot,
  };
  const envelope: Envelope = { ...body, digest: digest(body) };
  const source = JSON.stringify(envelope),
    compiled = PREFIX + source,
    typeDefs = registeredQuerySchema(snapshot);
  buildSchema(typeDefs);
  const version = contentVersion(source, typeDefs, compiled);
  return {
    link: { kind: "backend" as const, name, backendId, version },
    backend: { name, source, compiled, typeDefs },
    envelope,
  };
}
type BoundPage = Pick<HtmlPageVersion, "pageId" | "version" | "html">;
/** Verifies the persisted immutable bytes, the link and the retained provenance of a registered
 * program on this page, without its page-version binding. Null when the backend is not registered. */
function verifiedEnvelope(
  pageId: string,
  link: HtmlBackendLink,
  backend: HtmlBackendVersionRecord,
): Envelope | null {
  if (!backend.compiled.startsWith(PREFIX)) return null;
  if (
    backend.backendId !== link.backendId ||
    backend.version !== link.version ||
    backend.pageId !== pageId ||
    backend.name !== link.name ||
    backend.secretBindings?.length
  )
    throw Error("query_registration_changed");
  let envelope: Envelope;
  try {
    envelope = JSON.parse(backend.source);
  } catch {
    throw Error("invalid_query_registration");
  }
  const { digest: claimed, ...body } = envelope;
  if (
    envelope.kind !== "registered-page-queries-v1" ||
    claimed !== digest(body) ||
    envelope.pageId !== pageId ||
    ![
      envelope.provenance?.compilerSha256,
      envelope.provenance?.sourceSha256,
      envelope.provenance?.sqlEngineSha256,
    ].every((v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v)) ||
    backend.compiled !== PREFIX + backend.source ||
    backend.typeDefs !== registeredQuerySchema(envelope.program) ||
    backend.version !==
      contentVersion(backend.source, backend.typeDefs, backend.compiled)
  )
    throw Error("query_registration_changed");
  return envelope;
}
/** Verifies all persisted immutable bytes, actual page source, link and retained provenance. */
export function registeredPlan(
  page: BoundPage,
  link: HtmlBackendLink,
  backend: HtmlBackendVersionRecord,
): QueryPlan | null {
  const envelope = verifiedEnvelope(page.pageId, link, backend);
  if (!envelope) return null;
  if (
    envelope.pageVersion !== page.version ||
    envelope.sourceSha256 !== pageSourceDigest(page.html)
  )
    throw Error("query_registration_changed");
  return {
    ...structuredClone(envelope.program),
    registration: {
      pageId: page.pageId,
      pageVersion: page.version,
      sourceSha256: envelope.sourceSha256,
      backendId: link.backendId,
      backendVersion: link.version,
    },
  };
}
/** Call INSIDE the page publication transaction AFTER writing its immutable version/link.
 * No reader can see the page until both page and program commit. No updates to saved versions. */
export async function commitRegisteredQueryBackend(
  tx: Queryable,
  page: BoundPage,
  ownerId: string,
  prepared: ReturnType<typeof prepareRegisteredQueryBackend>,
): Promise<void> {
  type Saved = { source: string; meta: { htmlLinks?: HtmlBackendLink[] } };
  const head = (
    await tx.query<Saved & { user_id: string | null; version: number }>(
      "SELECT user_id,version,source,meta FROM artifacts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [page.pageId],
    )
  ).rows[0];
  // An ordinary save archives the PREVIOUS version, so the version it just wrote is the locked head row.
  const saved =
    (
      await tx.query<Saved>(
        "SELECT source,meta FROM artifact_versions WHERE artifact_id=$1 AND version=$2",
        [page.pageId, page.version],
      )
    ).rows[0] ?? (head?.version === page.version ? head : undefined);
  if (
    !head ||
    head.user_id !== ownerId ||
    head.version !== page.version ||
    !saved ||
    saved.source !== page.html ||
    !saved.meta.htmlLinks?.some(
      (link) =>
        link.kind === "backend" &&
        link.name === prepared.link.name &&
        link.backendId === prepared.link.backendId &&
        link.version === prepared.link.version,
    )
  )
    throw Error("query_registration_changed");
  const record = {
    ...prepared.backend,
    ...prepared.link,
    pageId: page.pageId,
    ownerId,
    secretBindings: [],
  };
  registeredPlan(page, prepared.link, record);
  await tx.query(
    "SELECT pg_advisory_xact_lock(hashtext('registered-backend:' || $1))",
    [prepared.link.backendId],
  );
  const prior = (
    await tx.query<{ page_id: string; owner_id: string }>(
      "SELECT page_id,owner_id FROM html_backend_versions WHERE backend_id=$1 LIMIT 1",
      [prepared.link.backendId],
    )
  ).rows[0];
  if (prior && (prior.page_id !== page.pageId || prior.owner_id !== ownerId))
    throw Error("query_registration_changed");
  await tx.query(
    "INSERT INTO html_backend_versions(backend_id,version,page_id,name,source,type_defs,compiled,owner_id,secret_bindings) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT DO NOTHING",
    [
      prepared.link.backendId,
      prepared.link.version,
      page.pageId,
      prepared.link.name,
      prepared.backend.source,
      prepared.backend.typeDefs,
      prepared.backend.compiled,
      ownerId,
      "[]",
    ],
  );
}

/**
 * RE-BINDING ON SAVE. A registered program is bound to one exact page version and its source
 * digest, so every later save of the page (owner or editor, replace or revert) must carry the
 * program forward or the page's `queries` namespace stops resolving.
 *
 * Why re-binding is valid: the program is NOT compiled from the page HTML. It was compiled by the
 * migration from the ORIGINAL source document (`provenance.sourceSha256`), is self-contained
 * (queries, scalars, imports, local tables) and is verified byte-for-byte here. The page HTML only
 * declares the namespace (`<link rel="af-backend" data-af-name>`) and calls it over GraphQL. So the
 * program still fits a new version exactly when:
 *  - the new HTML still declares the name (otherwise the existing link logic drops the link), and
 *  - the save does not supply its own backend source for that name (`backendSources` wins; the
 *    caller passes only links it carries forward unchanged).
 * When those hold, the same program and provenance are prepared for the new version and committed
 * through `commitRegisteredQueryBackend`, under the same backend ID and owner.
 *
 * When a carried registered program can NOT be re-bound (its stored bytes fail verification, it is
 * bound to another page or a later version, the program no longer passes `prepare`, or the page
 * owner is no longer the program's owner), this throws `RegisteredQueryRebindError` BEFORE anything
 * is written, and the save is refused with `registered_queries_rebind_failed`. A page is never saved
 * with a link that would silently 404; the author can replace the backend through `backendSources`
 * or remove its `<link>`.
 */
export class RegisteredQueryRebindError extends Error {
  constructor(
    readonly namespace: string,
    readonly reason: string,
  ) {
    super(`registered queries '${namespace}' cannot be re-bound: ${reason}`);
  }
}
export interface RegisteredQueryRebind {
  ownerId: string;
  prepared: ReturnType<typeof prepareRegisteredQueryBackend>;
}
/** Call under the page's write lock, BEFORE writing `next`. Returns the links to save
 * (registered ones re-bound to `next`, every other link unchanged) and the programs to commit. */
export async function planRegisteredQueryRebinds(
  tx: Queryable,
  next: BoundPage,
  carried: readonly HtmlBackendLink[],
  pageOwnerId: string | null,
): Promise<{ links: HtmlBackendLink[]; rebinds: RegisteredQueryRebind[] }> {
  const links: HtmlBackendLink[] = [],
    rebinds: RegisteredQueryRebind[] = [];
  for (const link of carried) {
    const backend = (
      await tx.query<HtmlBackendVersionRecord>(
        'SELECT backend_id AS "backendId",version,page_id AS "pageId",name,source,type_defs AS "typeDefs",compiled,owner_id AS "ownerId",secret_bindings AS "secretBindings" FROM html_backend_versions WHERE backend_id=$1 AND version=$2',
        [link.backendId, link.version],
      )
    ).rows[0];
    if (!backend?.compiled.startsWith(PREFIX)) {
      links.push(link);
      continue;
    }
    let prepared: RegisteredQueryRebind["prepared"];
    try {
      const envelope = verifiedEnvelope(next.pageId, link, backend)!;
      if (envelope.pageVersion >= next.version)
        throw Error("query_registration_changed");
      if (backend.ownerId !== pageOwnerId)
        throw Error("query_registration_owner_changed");
      prepared = prepareRegisteredQueryBackend(
        link.name,
        link.backendId,
        next,
        envelope.program,
        envelope.provenance,
      );
    } catch (error) {
      throw new RegisteredQueryRebindError(
        link.name,
        error instanceof Error ? error.message : "invalid_query_registration",
      );
    }
    links.push(prepared.link);
    rebinds.push({ ownerId: backend.ownerId, prepared });
  }
  return { links, rebinds };
}
/** Call INSIDE the same transaction AFTER writing `page` with the planned links. */
export async function commitRegisteredQueryRebinds(
  tx: Queryable,
  page: BoundPage,
  rebinds: readonly RegisteredQueryRebind[],
): Promise<void> {
  for (const { ownerId, prepared } of rebinds)
    await commitRegisteredQueryBackend(tx, page, ownerId, prepared);
}
/**
 * One-off repair for a head that was saved before re-binding existed: its registered links still
 * name a program bound to an earlier version. Re-binds them to the CURRENT head in place (the head
 * is not yet archived, so no saved version changes) through the same plan/commit path.
 * Returns the re-bound namespaces; an already valid or unregistered page is left untouched.
 */
export async function repairRegisteredQueryHead(
  tx: Queryable,
  pageId: string,
): Promise<string[]> {
  const head = (
    await tx.query<{
      user_id: string | null;
      version: number;
      source: string | null;
      format: string;
      meta: { htmlLinks?: (HtmlBackendLink | { kind: "dataset" })[] };
    }>(
      "SELECT user_id,version,source,format,meta FROM artifacts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [pageId],
    )
  ).rows[0];
  if (!head || head.format !== "html" || head.source === null)
    throw Error("page_unavailable");
  const page = { pageId, version: head.version, html: head.source };
  const all = head.meta.htmlLinks ?? [];
  const stale: HtmlBackendLink[] = [];
  for (const link of all) {
    if (link.kind !== "backend") continue;
    const backend = (
      await tx.query<HtmlBackendVersionRecord>(
        'SELECT backend_id AS "backendId",version,page_id AS "pageId",name,source,type_defs AS "typeDefs",compiled,owner_id AS "ownerId",secret_bindings AS "secretBindings" FROM html_backend_versions WHERE backend_id=$1 AND version=$2',
        [link.backendId, link.version],
      )
    ).rows[0];
    if (!backend) continue;
    const envelope = verifiedEnvelope(pageId, link, backend);
    if (envelope && envelope.pageVersion !== head.version) stale.push(link);
  }
  if (!stale.length) return [];
  const planned = await planRegisteredQueryRebinds(tx, page, stale, head.user_id);
  const links = all.map(
    (link) =>
      (link.kind === "backend" &&
        planned.links.find((next) => next.name === link.name)) ||
      link,
  );
  await tx.query(
    "UPDATE artifacts SET meta=jsonb_set(meta,'{htmlLinks}',$2::jsonb) WHERE id=$1 AND version=$3",
    [pageId, JSON.stringify(links), head.version],
  );
  await commitRegisteredQueryRebinds(tx, page, planned.rebinds);
  for (const link of planned.links)
    registeredPlan(
      page,
      link,
      (
        await tx.query<HtmlBackendVersionRecord>(
          'SELECT backend_id AS "backendId",version,page_id AS "pageId",name,source,type_defs AS "typeDefs",compiled,owner_id AS "ownerId",secret_bindings AS "secretBindings" FROM html_backend_versions WHERE backend_id=$1 AND version=$2',
          [link.backendId, link.version],
        )
      ).rows[0]!,
    );
  return stale.map((link) => link.name);
}
