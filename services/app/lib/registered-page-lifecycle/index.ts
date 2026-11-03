import { buildSchema } from 'graphql';
import { createHash } from 'node:crypto';
import type { HtmlBackendLink, HtmlPageVersion, Queryable } from '@artifactbin/contracts';
import type { HtmlBackendVersionRecord } from '@/lib/html-backends';

export type BoundPage = Pick<HtmlPageVersion, 'pageId' | 'version' | 'html'>;
export interface RepairableHead {
  id: string;
  user_id: string | null;
  version: number;
  source: string;
  meta: { htmlLinks?: (HtmlBackendLink | { kind: 'dataset' })[] };
}
export interface RegisteredRepair {
  links: (HtmlBackendLink | { kind: 'dataset' })[];
  /** Caller writes links to the locked head before committing the programs. */
  commit(): Promise<string[]>;
}
interface Provenance { compilerSha256: string; sourceSha256: string }
interface Envelope<Program, Origin> {
  kind: string;
  pageId: string;
  pageVersion: number;
  sourceSha256: string;
  provenance: Origin;
  program: Program;
  digest: string;
}
interface Prepared<Program, Origin> {
  link: HtmlBackendLink;
  backend: { name: string; source: string; compiled: string; typeDefs: string };
  envelope: Envelope<Program, Origin>;
}
export const pageSourceDigest = (html: string) => createHash('sha256').update(html).digest('hex');
/**
 * KEPT FOR EXISTING PAGES ONLY (118 live pages on 3 Nov 2026 serve registered queries or mutations). No page gains a
 * registered program any more: a fork would copy one onto a new page (planHtmlClone) and a revert could restore one to
 * a head that no longer carries it (rebind's `held`); both refuse with this error. A page that carries one today
 * keeps serving, saving and re-binding it until a migration removes them.
 */
export const isRegisteredPageProgram = (compiled: string): boolean => compiled.startsWith('!registered-page-');
export class NewRegistrationRefused extends Error {
  readonly body: { error: 'registered_programs_retired'; namespace: string; details: string[] };
  constructor(readonly namespace: string) {
    super(`'${namespace}' would add a registered query or mutation program to a page that has none`);
    this.body = { error: 'registered_programs_retired', namespace, details: [`Pages no longer register queries or mutations: ${this.message}. ` +
      `Read and write data through a dataset and its generated GraphQL API, or supply a <link rel="af-resolver"> backend in resolverSources.`] };
  }
}
const digest = (value: unknown) => pageSourceDigest(JSON.stringify(value));
const contentVersion = (source: string, typeDefs: string, compiled: string) => digest([source, typeDefs, compiled, []]);
const backendRecord = async (tx: Queryable, link: HtmlBackendLink) => (await tx.query<HtmlBackendVersionRecord>(
  'SELECT backend_id AS "backendId",version,page_id AS "pageId",name,source,type_defs AS "typeDefs",compiled,owner_id AS "ownerId",secret_bindings AS "secretBindings" FROM html_backend_versions WHERE backend_id=$1 AND version=$2',
  [link.backendId, link.version],
)).rows[0];

/** Immutable registered backend lifecycle, used only by the query and mutation adapters (the publication doors import
 * only isRegisteredPageProgram and NewRegistrationRefused above).
 * Adapters own program validation, SDL, required provenance and their public rebind error.
 * Every database operation uses the supplied transaction; no independent DB access or effects. */
export function registeredPageLifecycle<Program, Origin extends Provenance>(adapter: {
  kind: 'registered-page-queries-v1' | 'registered-page-mutations-v1';
  error: 'query' | 'mutation';
  provenanceKeys: readonly (keyof Origin)[];
  validate(program: Program, page: BoundPage, backendId: string): void;
  schema(program: Program): string;
  rebindError(namespace: string, reason: string): Error;
}) {
  const prefix = `!${adapter.kind}\n`;
  const changed = `${adapter.error}_registration_changed`;
  const invalid = `invalid_${adapter.error}_registration`;
  const validProvenance = (origin: Origin, strict: boolean) => adapter.provenanceKeys.every(key =>
    (!strict || typeof origin?.[key] === 'string') && /^[a-f0-9]{64}$/.test(origin?.[key] as string));

  /** Trusted host preparation only. Invalid-JavaScript prefix cannot come from public compilation.
   * Property order and content-addressing are persisted compatibility contracts. */
  function prepare(name: string, backendId: string, page: BoundPage, program: Program, provenance: Origin): Prepared<Program, Origin> {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) || !/^[A-Za-z0-9_-]{1,128}$/.test(backendId) ||
        !Number.isSafeInteger(page.version) || page.version < 1 || !validProvenance(provenance, false)) throw Error(invalid);
    const snapshot = structuredClone(program);
    adapter.validate(snapshot, page, backendId);
    const body = { kind: adapter.kind, pageId: page.pageId, pageVersion: page.version,
      sourceSha256: pageSourceDigest(page.html), provenance: structuredClone(provenance), program: snapshot };
    const envelope = { ...body, digest: digest(body) };
    const source = JSON.stringify(envelope), compiled = prefix + source, typeDefs = adapter.schema(snapshot);
    buildSchema(typeDefs);
    return { link: { kind: 'backend', name, backendId, version: contentVersion(source, typeDefs, compiled) },
      backend: { name, source, compiled, typeDefs }, envelope };
  }

  /** Verify immutable bytes and provenance independently of the page-version binding. */
  function verifiedEnvelope(pageId: string, link: HtmlBackendLink, backend: HtmlBackendVersionRecord): Envelope<Program, Origin> | null {
    if (!backend.compiled.startsWith(prefix)) return null;
    if (backend.backendId !== link.backendId || backend.version !== link.version || backend.pageId !== pageId ||
        backend.name !== link.name || backend.secretBindings?.length) throw Error(changed);
    let envelope: Envelope<Program, Origin>;
    try { envelope = JSON.parse(backend.source); } catch { throw Error(invalid); }
    const { digest: claimed, ...body } = envelope;
    if (envelope.kind !== adapter.kind || claimed !== digest(body) || envelope.pageId !== pageId ||
        !validProvenance(envelope.provenance, true) || backend.compiled !== prefix + backend.source ||
        backend.typeDefs !== adapter.schema(envelope.program) ||
        backend.version !== contentVersion(backend.source, backend.typeDefs, backend.compiled)) throw Error(changed);
    return envelope;
  }

  function plan(page: BoundPage, link: HtmlBackendLink, backend: HtmlBackendVersionRecord) {
    const envelope = verifiedEnvelope(page.pageId, link, backend);
    if (!envelope) return null;
    if (envelope.pageVersion !== page.version || envelope.sourceSha256 !== pageSourceDigest(page.html)) throw Error(changed);
    return { ...structuredClone(envelope.program), registration: { pageId: page.pageId, pageVersion: page.version,
      sourceSha256: envelope.sourceSha256, backendId: link.backendId, backendVersion: link.version } };
  }

  /** After the page/link write, in its publication transaction. The locked head is authoritative;
   * ordinary saves archive the PREVIOUS version, so the new version may exist only in the head. */
  async function commit(tx: Queryable, page: BoundPage, ownerId: string, prepared: Prepared<Program, Origin>): Promise<void> {
    type Saved = { source: string; meta: { htmlLinks?: HtmlBackendLink[] } };
    const head = (await tx.query<Saved & { user_id: string | null; version: number }>(
      'SELECT user_id,version,source,meta FROM artifacts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [page.pageId],
    )).rows[0];
    const saved = (await tx.query<Saved>('SELECT source,meta FROM artifact_versions WHERE artifact_id=$1 AND version=$2',
      [page.pageId, page.version])).rows[0] ?? (head?.version === page.version ? head : undefined);
    if (!head || head.user_id !== ownerId || head.version !== page.version || !saved || saved.source !== page.html ||
        !saved.meta.htmlLinks?.some(link => link.kind === 'backend' && link.name === prepared.link.name &&
          link.backendId === prepared.link.backendId && link.version === prepared.link.version)) throw Error(changed);
    plan(page, prepared.link, { ...prepared.backend, ...prepared.link, pageId: page.pageId, ownerId, secretBindings: [] });
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('registered-backend:' || $1))", [prepared.link.backendId]);
    const prior = (await tx.query<{ page_id: string; owner_id: string }>(
      'SELECT page_id,owner_id FROM html_backend_versions WHERE backend_id=$1 LIMIT 1', [prepared.link.backendId],
    )).rows[0];
    if (prior && (prior.page_id !== page.pageId || prior.owner_id !== ownerId)) throw Error(changed);
    await tx.query(
      'INSERT INTO html_backend_versions(backend_id,version,page_id,name,source,type_defs,compiled,owner_id,secret_bindings) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT DO NOTHING',
      [prepared.link.backendId, prepared.link.version, page.pageId, prepared.link.name, prepared.backend.source,
        prepared.backend.typeDefs, prepared.backend.compiled, ownerId, '[]'],
    );
  }

  type Rebind = { ownerId: string; prepared: Prepared<Program, Origin> };
  const carriesRegistration = async (tx: Queryable, link: HtmlBackendLink, held: readonly HtmlBackendLink[]) => {
    for (const head of held) {
      if (head.backendId !== link.backendId) continue;
      if (head.version === link.version || (await backendRecord(tx, head))?.compiled.startsWith(prefix)) return true;
    }
    return false;
  };
  /** Under the page write lock, before writing next. Program/provenance come from the original
   * migration, not HTML: declared namespaces with no replacement source carry forward unchanged.
   * A failed verification refuses the save, rather than publishing a namespace that silently 404s.
   * `held` is the locked head's backend links: a program is re-bound only where the head carries a registered
   * program under the same backend ID today (NewRegistrationRefused otherwise, so a revert cannot restore one). */
  async function rebind(tx: Queryable, next: BoundPage, carried: readonly HtmlBackendLink[], pageOwnerId: string | null, held: readonly HtmlBackendLink[]) {
    const links: HtmlBackendLink[] = [], rebinds: Rebind[] = [];
    for (const link of carried) {
      const backend = await backendRecord(tx, link);
      if (!backend?.compiled.startsWith(prefix)) { links.push(link); continue; }
      if (!await carriesRegistration(tx, link, held)) throw new NewRegistrationRefused(link.name);
      let prepared: Prepared<Program, Origin>;
      try {
        const envelope = verifiedEnvelope(next.pageId, link, backend)!;
        if (envelope.pageVersion >= next.version) throw Error(changed);
        if (backend.ownerId !== pageOwnerId) throw Error(`${adapter.error}_registration_owner_changed`);
        prepared = prepare(link.name, link.backendId, next, envelope.program, envelope.provenance);
      } catch (error) {
        throw adapter.rebindError(link.name, error instanceof Error ? error.message : invalid);
      }
      links.push(prepared.link);
      rebinds.push({ ownerId: backend.ownerId, prepared });
    }
    return { links, rebinds };
  }
  async function commitRebinds(tx: Queryable, page: BoundPage, rebinds: readonly Rebind[]): Promise<void> {
    for (const { ownerId, prepared } of rebinds) await commit(tx, page, ownerId, prepared);
  }

  /** Repair a pre-rebinding head in place. Caller holds its lock and writes planned links before
   * commit. Archived versions are never changed; current/unregistered heads require no work. */
  async function repair(tx: Queryable, head: RepairableHead): Promise<RegisteredRepair | null> {
    const page = { pageId: head.id, version: head.version, html: head.source }, all = head.meta.htmlLinks ?? [];
    const stale: HtmlBackendLink[] = [];
    for (const link of all) {
      if (link.kind !== 'backend') continue;
      const backend = await backendRecord(tx, link);
      if (!backend) continue;
      const envelope = verifiedEnvelope(head.id, link, backend);
      if (envelope && envelope.pageVersion !== head.version) stale.push(link);
    }
    if (!stale.length) return null;
    const planned = await rebind(tx, page, stale, head.user_id, stale);
    const links = all.map(link => (link.kind === 'backend' && planned.links.find(next => next.name === link.name)) || link);
    return { links, async commit() {
      await commitRebinds(tx, page, planned.rebinds);
      for (const link of planned.links) plan(page, link, (await backendRecord(tx, link))!);
      return stale.map(link => link.name);
    } };
  }
  return { prepare, plan, commit, rebind, commitRebinds, repair };
}
