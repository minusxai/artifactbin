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
/** Verifies all persisted immutable bytes, actual page source, link and retained provenance. */
export function registeredPlan(
  page: HtmlPageVersion,
  link: HtmlBackendLink,
  backend: HtmlBackendVersionRecord,
): QueryPlan | null {
  if (!backend.compiled.startsWith(PREFIX)) return null;
  if (
    backend.backendId !== link.backendId ||
    backend.version !== link.version ||
    backend.pageId !== page.pageId ||
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
    envelope.pageId !== page.pageId ||
    envelope.pageVersion !== page.version ||
    envelope.sourceSha256 !== pageSourceDigest(page.html) ||
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
  page: HtmlPageVersion,
  ownerId: string,
  prepared: ReturnType<typeof prepareRegisteredQueryBackend>,
): Promise<void> {
  const head = (
    await tx.query<{ user_id: string | null; version: number }>(
      "SELECT user_id,version FROM artifacts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [page.pageId],
    )
  ).rows[0];
  const saved = (
    await tx.query<{ source: string; meta: { htmlLinks?: HtmlBackendLink[] } }>(
      "SELECT source,meta FROM artifact_versions WHERE artifact_id=$1 AND version=$2",
      [page.pageId, page.version],
    )
  ).rows[0];
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
