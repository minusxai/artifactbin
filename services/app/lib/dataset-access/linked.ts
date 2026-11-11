/**
 * THE DATASETS A REQUEST READS AND WRITES: one dataset directly (its own sharing decides the role) or a page's dataset
 * links (the page audience rule), loaded once per request for the caller: the read snapshot through the retained port
 * (./retained), the write decision, and per table the model both doors read: its columns, what the role may write
 * (`write`) and change (`can`). The page SQL door (./page-sql-door) and the GraphQL compatibility layer
 * (lib/graphql-compat) both load through here, so a role reads and writes exactly the same rows through either.
 *
 * The table model keeps its generated-API names (`root`, each column's `field`; ./table-model): a link's tables are
 * named once, and two links generating one name refuse the page in either door.
 */
import { GraphQLError } from 'graphql';
import { DATASET_GRAPHQL_WRITE_LIMITS, type DatasetBoolExp, type DatasetColumn, type DatasetGraphqlError, type DatasetGraphqlErrorCode, type HtmlDatasetLink, type Queryable } from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { liveAccessFacts, memoAccessFacts, type AccessFacts } from '@/lib/artifact-access';
import { getArtifactById } from '@/lib/artifacts';
import { datasetWriteAccess, tableMutationPolicy } from '@/lib/dataset-permissions';
import type { DatasetTable } from '@/lib/datasets';
import { hasuraGeneratedNames, hasuraNames, storedConfiguration, type HasuraTableNames } from '@/lib/datasets/graphql-names';
import { tableIdentity } from './model';
import { retainedDatasetGraphqlPort } from './retained';
import type { HasuraCan, HasuraColumn, HasuraRowCan, HasuraScalar, HasuraTableModel, HasuraWriteModel } from './table-model';
import { datasetBindingCatalog, DatasetBindingUnsupportedError } from './authority';
import { collaborativeColumns } from './cells';
import type { DatasetSnapshot } from './types';

const error = (message: string, code: DatasetGraphqlErrorCode): DatasetGraphqlError => ({ message, extensions: { code } });

const scalarOf = (type: DatasetColumn['type']): HasuraScalar => (type === 'number' ? 'Float' : type === 'boolean' ? 'Boolean' : 'String');

export const notFound = () => new Error('dataset_not_found');

export interface LoadedTable { model: HasuraTableModel; tableId: string; declared: DatasetTable }
export interface Loaded {
  datasetId: string;
  /** Through a page: the link it was loaded for (its page name). */
  link?: HtmlDatasetLink;
  /** The caller's read snapshot, or null when the role selects nothing (it may still write). */
  snapshot: DatasetSnapshot | null;
  tables: LoadedTable[];
  port: ReturnType<typeof retainedDatasetGraphqlPort>;
  fences: Array<() => Promise<void>>;
}
/** One loaded link, for the page SQL door (./page-sql-door) and the GraphQL compatibility layer. */
export type LoadedDataset = Loaded;
type WriteDecision = Awaited<ReturnType<typeof datasetWriteAccess>>;

const NOTHING: HasuraCan = { insert: false, update: false, delete: false };

/**
 * The role's write rules for one table, as the columns each lets it name (presets excluded), and what they let it
 * change (`can`): an insert root it has, an update root or delete rule it has with that rule's filter (true for every
 * row when the filter is empty, the owner's and editors'). A rule the role may not use here (`backend_only`) is absent.
 */
function writeRules(decision: WriteDecision, table: DatasetTable, names: HasuraTableNames): { write?: HasuraWriteModel; can: HasuraCan } {
  if (!decision.allowed) return { can: NOTHING };
  const column = (c: DatasetColumn): HasuraColumn => ({ field: names.columns[c.name] ?? (() => { throw notFound(); })(), source: c.name, type: scalarOf(c.type) });
  if (decision.admin) {
    const all = table.columns.map(column);
    return { write: { insert: all, update: all, delete: true }, can: { insert: all.length > 0, update: all.length > 0, delete: true } };
  }
  let policy: ReturnType<typeof tableMutationPolicy>;
  try { policy = tableMutationPolicy(decision, table); } catch { return { can: NOTHING }; }
  if (!policy) return { can: NOTHING };
  const { table: rules, role, operations } = policy;
  const rule = <P>(op: 'insert' | 'update' | 'delete', entries: Array<{ role: string; permission: P }> | undefined) => (operations.includes(op) ? entries?.find((e) => e.role === role)?.permission : undefined);
  const named = (p: { columns?: '*' | string[]; set?: Record<string, unknown> }) =>
    table.columns.filter((c) => (p.columns === undefined || p.columns === '*' || p.columns.includes(c.name)) && !Object.hasOwn(p.set ?? {}, c.name)).map(column);
  const insert = rule('insert', rules.insert_permissions), update = rule('update', rules.update_permissions), del = rule('delete', rules.delete_permissions);
  const write: HasuraWriteModel = { ...(insert ? { insert: named(insert) } : {}), ...(update ? { update: named(update) } : {}), ...(del ? { delete: true } : {}) };
  const rows = (filter: DatasetBoolExp | undefined): HasuraRowCan => (!filter || !Object.keys(filter).length ? true : { filter, session: decision.session });
  return {
    write,
    can: {
      insert: !!write.insert?.length,
      update: update && write.update?.length ? rows(update.filter as DatasetBoolExp | undefined) : false,
      delete: del ? rows(del.filter as DatasetBoolExp | undefined) : false,
    },
  };
}

export const columnsOf = (table: DatasetTable, names: HasuraTableNames, collaborative: readonly string[] = []): HasuraColumn[] =>
  table.columns.map((c) => ({ field: names.columns[c.name] ?? (() => { throw notFound(); })(), source: c.name, type: scalarOf(c.type), ...(c.type === 'string' && collaborative.includes(c.name) ? { collaborative: true } : {}) }));

/** How a load reaches the dataset: directly (its own sharing decides), or through a page (the page audience rule). */
export interface LoadMode {
  deferRowIds?: boolean;
  direct: boolean;
  /** The caller checks the load's fences before anything read leaves: the load's one authorization holds until then. */
  fenced: boolean;
  /** The request's memo of the caller's access facts, shared by every dataset it loads; fences never read it. */
  facts?: AccessFacts;
  /** Through a page: the page the session names (`X-Hasura-Page-Id`). */
  pageId?: string;
  /** Through a page: each read fence is also handed to the page request's own final check. */
  retainReadFence?: (verify: () => Promise<void>) => void;
}

/**
 * The caller's read snapshot and write decision, and the table models they give. Directly the dataset's own
 * sharing decides the role; through a page (the page SQL door, page GraphQL) the page audience rule applies
 * (a reader with no sharing of their own is signed_in or anonymous) and the session names the page. A pinned link
 * reads its recorded revision and never writes. Throws `dataset_not_found` when the role may neither read nor
 * write (the uniform 404). One authorization: the read and write decisions share the head and the request's facts.
 */
export async function load(actor: AccessActor, binding: HtmlDatasetLink, signal: AbortSignal, mode: LoadMode): Promise<Loaded> {
  const fences: Array<() => Promise<void>> = [];
  const facts = mode.facts ?? memoAccessFacts(liveAccessFacts(actor));
  const port = retainedDatasetGraphqlPort({ direct: mode.direct, fenced: mode.fenced, deferRowIds: mode.deferRowIds, facts, ...(mode.pageId ? { pageId: mode.pageId } : {}), retainReadFence: (verify) => { fences.push(verify); mode.retainReadFence?.(verify); } });
  if (binding.mode === 'pinned') {
    // A pinned link: reads only, exactly the tables of the snapshot its recorded revision resolves.
    const read = await port.snapshot(actor, binding, signal);
    const tables = read.catalog.tables.map((table): LoadedTable => {
      const tableId = tableIdentity(table), names = read.names?.[tableId] ?? (() => { throw notFound(); })();
      return { model: { root: names.root, table: { schema: table.schema, name: table.name }, columns: columnsOf(table, names) }, tableId, declared: table };
    });
    if (!tables.length) throw notFound();
    return { datasetId: binding.datasetId, snapshot: read, tables, port, fences };
  }
  let snapshot: DatasetSnapshot | null = null;
  try { snapshot = await port.snapshot(actor, binding, signal); } catch (e) { if (!(e instanceof Error) || e.message !== 'dataset_not_found') throw e; }
  const row = snapshot?.head ?? await getArtifactById(binding.datasetId);
  if (!row || row.format !== 'dataset') throw notFound();
  const decision = await datasetWriteAccess(row, actor, { ...writeOptions(mode), facts });
  // Nothing is said about a dataset the role can neither read nor write, not even that it is unsupported.
  if (!snapshot && !decision.allowed) throw notFound();
  const declared = datasetBindingCatalog(row);
  const derived = hasuraNames(declared.tables, { title: row.title, configuration: storedConfiguration(row.dataset_policy) });
  const tables = declared.tables.flatMap((table, i): LoadedTable[] => {
    const tableId = tableIdentity(table), names = snapshot?.names?.[tableId] ?? derived[i]!;
    const visible = snapshot?.catalog.tables.find((t) => tableIdentity(t) === tableId);
    const { write, can } = writeRules(decision, table, names);
    if (!visible && !write) return [];
    const model: HasuraTableModel = {
      root: names.root,
      table: { schema: table.schema, name: table.name },
      // A live link's text columns the owner made collaborative say so (a pinned link never opens one).
      columns: visible ? columnsOf(visible, names, collaborativeColumns(row, table)) : [],
      ...(visible ? {} : { select: false }),
      ...(write ? { write } : {}),
      can,
    };
    return [{ model, tableId, declared: table }];
  });
  if (!tables.length) throw notFound();
  return { datasetId: binding.datasetId, snapshot, tables, port, fences };
}

const writeOptions = (mode: LoadMode) => (mode.direct ? { throughPage: false } : { throughPage: true, ...(mode.pageId ? { pageId: mode.pageId } : {}) });

export async function fenced(loaded: Loaded): Promise<void> {
  for (const verify of loaded.fences) await verify();
}

/** Where a page's datasets are read from: the page (its audience rule and `X-Hasura-Page-Id`) and its request's fences. */
export interface PageScope {
  pageId?: string;
  retainReadFence?: (verify: () => Promise<void>) => void;
}

/**
 * THE PAGE'S DATASETS AS ONE GENERATED API: every given link under its page name (a single-table dataset's root
 * is the link name; a multi-table dataset's are `<name>_<table root>`), for the caller's role through the page. A
 * dataset the role can neither read nor write is absent, as if unlinked. Two links generating one name refuse the
 * page (`graphql_root_collision`; publishing refuses it first).
 */
export async function loadLinked(actor: AccessActor, links: readonly HtmlDatasetLink[], scope: PageScope & { fenced: boolean; deferRowIds?: boolean }, signal: AbortSignal): Promise<Loaded[]> {
  const loaded: Loaded[] = [];
  // One authorization per request: every link's decisions read the caller's facts once.
  const facts = memoAccessFacts(liveAccessFacts(actor));
  for (const link of links) {
    let one: Loaded;
    try { one = await load(actor, link, signal, { direct: false, ...scope, facts }); } catch (e) {
      if (e instanceof Error && (e.message === 'dataset_not_found' || e instanceof DatasetBindingUnsupportedError)) continue;
      throw e;
    }
    loaded.push({ ...one, link, tables: one.tables.map((t) => ({ ...t, model: { ...t.model, root: linkedRoot(link.name, one.tables.length, t.model.root) } })) });
  }
  const names = new Map<string, string>();
  for (const l of loaded) for (const { model } of l.tables) for (const name of hasuraGeneratedNames(model.root)) {
    const other = names.get(name);
    if (other !== undefined) throw new GraphQLError(`graphql_root_collision: links ${other} and ${l.link!.name} both generate ${name}; rename a link`);
    names.set(name, l.link!.name);
  }
  return loaded;
}

/** A linked table's root in the page: the link name for a single-table dataset, `<name>_<table root>` otherwise. */
export const linkedRoot = (name: string, tables: number, root: string) => (tables === 1 ? name : `${name}_${root}`);
/**
 * Under the dataset's row lock, inside the write's commit: the page the write goes through still holds (its head,
 * its links, the reader's access to it). Throws DatasetError when it does not; nothing then commits.
 */
export type PageCommitGuard = (tx: Queryable) => Promise<void>;
/** One refused write as a GraphQL error: the code says what happened, the message never carries row data. */
export function refusal(result: { reason: string; detail: string }): DatasetGraphqlError {
  switch (result.reason) {
    case 'too_many_rows': return error(`a mutation changes at most ${DATASET_GRAPHQL_WRITE_LIMITS.rows} rows; nothing was written`, 'too_many_rows');
    case 'policy_denied': return /failed its check/.test(result.detail) ? error('check constraint of an insert/update permission has failed; nothing was written', 'check_violation') : error(result.detail, 'permission_denied');
    case 'dataset_read_only': return error(result.detail, 'permission_denied');
    case 'contended': return error('the dataset is being written too quickly to apply this change; retry', 'dataset_changed');
    case 'conflict': return error('the write met concurrent writers and was not applied; retry the same request', 'dataset_changed');
    // A rule naming a session variable this caller lacks (X-Hasura-User-Id for anonymous) denies them.
    default: return /session variable is unavailable/.test(result.detail) ? error('this rule needs a signed-in session', 'permission_denied') : error(result.detail, 'validation_failed');
  }
}

/** A refused write as the page SQL door answers it: the same code and message as the generated API's. */
export function sqlRefusal(result: { reason: string; detail: string }): { code: string; message: string } {
  const e = refusal(result);
  return { code: e.extensions.code, message: e.message };
}
