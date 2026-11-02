/**
 * WHO MAY READ A DATASET, AND WHICH ROWS: one decision every row-reading door asks, and the role view
 * (./view) it hands them.
 *
 *  - The role is the dataset's own sharing (./role). Owner and editor are admin-equivalent: the whole
 *    dataset. Every other role sees only what its v3 select entry allows (./to-v3 reads stored v1/v2
 *    policies as v3); a role with no select entry on any table gets the uniform 404.
 *  - Stored v1/v2/no policies keep today's read outcomes until the stored rewrite (PR 9):
 *    · A PRIVATE dataset's signed_in and anonymous rules never apply (the visibility ceiling), except, for
 *      no policy or v1, to a reader arriving through a document whose owner holds owner or editor on the
 *      dataset: a page's <Query>/<Import> and registered queries read by the page owner's reach today
 *      (v2 grants never did: their private ceiling admits shares only).
 *    · A v2 read grant that admits this caller today (`grantsPermitRead`: a named person, a page-scoped
 *      grant through that page) keeps admitting them to the whole dataset. v3 has no slot for one
 *      person or one page, so this compatibility lives here and nowhere else, as the write one does.
 *  - The decision's `identity` names the role, the policy revision, the session and the rules, for
 *    cursors and read fences: any change refuses a continuation.
 */
import {
  type DatasetRole,
  type DatasetRuleRole,
  type DatasetSelectPermission,
  type DatasetTableName,
  type Queryable,
  type Scalar,
} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { grantsOf, grantsPermitRead, liveAccessFacts, type AccessFacts, type ArtifactRow, type ReadRow } from '@/lib/artifact-access';
import { catalogOf, DatasetError, loadDatasetRows, type CatalogRowView, type DatasetCatalog, type DatasetTable } from '@/lib/datasets';
import { getDb } from '@/lib/platform';
import { datasetRole, type DatasetRoleRow } from './role';
import { toV3, type ToV3Result } from './to-v3';
import { documentOwnerAdmin } from './write';
import { shows, unrestricted, viewRows, type DatasetSession } from './view';

/** The dataset columns a read decision consults: its access columns, its policy and its catalog. */
export type DatasetReadRow = DatasetRoleRow & Pick<ArtifactRow, 'format' | 'meta'> & Partial<Pick<ArtifactRow, 'dataset_policy' | 'policy_revision'>>;

export interface DatasetReadOptions {
  /** The caller arrives through a page linking the dataset (page GraphQL): page readers get signed_in or anonymous. */
  throughPage?: boolean;
  /** The saved document carrying the read (registered queries, notifications, images); implies `throughPage`. */
  document?: ReadRow;
  /** The page whose GraphQL carries the read (its `X-Hasura-Page-Id`); implies `throughPage`. */
  pageId?: string;
  /** Decide inside this transaction, with its facts. */
  tx?: Queryable;
  facts?: AccessFacts;
}

interface TableSelect extends DatasetTableName {
  /** The table's declared source columns: what a rule may show, hide or filter on. */
  columns: string[];
  permission: DatasetSelectPermission | null;
}
export type DatasetReadDecision =
  | { allowed: false; role: DatasetRole | null }
  | {
      allowed: true;
      role: DatasetRole;
      /** Owner or editor: the whole dataset, no rule applies. */
      admin: boolean;
      /** Every table readable whole: the view changes nothing (no materialisation). */
      full: boolean;
      tables: TableSelect[];
      session: DatasetSession;
      identity: string;
    };

const READ_ALL: DatasetSelectPermission = { columns: '*', filter: {}, allow_aggregations: true };
const same = (a: DatasetTableName, b: DatasetTableName) => a.schema === b.schema && a.name === b.name;

/** The dataset's catalog tables (a flat dataset's one `public.rows`) and their declared source columns. */
function tablesOf(row: Pick<ArtifactRow, 'meta'>): Array<DatasetTableName & { columns: string[] }> {
  const flat = ((row.meta as { columns?: Array<{ name: string }> } | null)?.columns ?? []).map((c) => c.name);
  return catalogOf(row)?.tables.map(({ schema, name, columns }) => ({ schema, name, columns: columns.map((c) => c.name) })) ?? [{ schema: 'public', name: 'rows', columns: flat }];
}

function permissionsOf(row: DatasetReadRow): ToV3Result | null {
  try { return toV3({ policy: row.dataset_policy ?? null, visibility: row.visibility, tables: tablesOf(row).map(({ schema, name }) => ({ schema, name })) }); } catch { return null; }
}

function admitted(row: DatasetReadRow, role: DatasetRole, tables: TableSelect[], session: DatasetSession, admin: boolean): DatasetReadDecision {
  const full = tables.every((t) => !!t.permission && unrestricted(t.permission));
  const identity = JSON.stringify([role, row.policy_revision ?? 0, session, admin ? null : tables.map(({ schema, name, permission }) => [schema, name, permission])]);
  return { allowed: true, role, admin, full, tables, session, identity };
}

/** The one read decision. `row` is the dataset head the caller reads (its policy revision is part of the answer). */
export async function datasetReadAccess(row: DatasetReadRow, actor: AccessActor, options: DatasetReadOptions = {}): Promise<DatasetReadDecision> {
  if (row.format !== 'dataset') return { allowed: false, role: null };
  const facts = options.facts ?? liveAccessFacts(actor, options.tx);
  const role = await datasetRole(row, actor, { facts, throughPage: !!options.throughPage || !!options.document || !!options.pageId });
  if (!role) return { allowed: false, role };
  const all = tablesOf(row).map((t) => ({ ...t, permission: READ_ALL }));
  const session: Record<string, Scalar> = {
    'x-hasura-role': role,
    ...(actor.userId ? { 'x-hasura-user-id': actor.userId } : {}),
    ...(options.document ? { 'x-hasura-page-id': options.document.id } : options.pageId ? { 'x-hasura-page-id': options.pageId } : {}),
  };
  if (role === 'owner' || role === 'editor') return admitted(row, role, all, session, true);
  const read = permissionsOf(row);
  // v2 compatibility: a grant admitting this caller today keeps admitting them, whole. Remove once the stored
  // migration (scripts/migrate-dataset-policies.ts) has been applied everywhere: named readers are shares by then.
  if ((read?.source === 'v2' || (!read && grantsOf(row))) && await grantsPermitRead(row as ReadRow, actor, options.document, options.tx, facts)) {
    return admitted(row, role, all, session, false);
  }
  if (!read) return { allowed: false, role };
  if (read.source !== 'v3' && row.visibility === 'private' && (role === 'signed_in' || role === 'anonymous')) {
    // v2 grants never let a page reach past a private dataset's shares (grantsPermitRead's ceiling).
    if (read.source === 'v2') return { allowed: false, role };
    const doc = options.document;
    const owner = doc && { userId: doc.group_id ? null : doc.user_id, tokenId: doc.group_id ? null : doc.token_id, groupId: doc.group_id ?? null };
    if (!owner || !(await documentOwnerAdmin(row as ArtifactRow, owner, options.tx ?? await getDb()))) return { allowed: false, role };
  }
  const tables = tablesOf(row).map((table): TableSelect => {
    const entry = read.policy.tables.find((t) => same(t.table, table))?.select_permissions?.find((e) => e.role === (role as DatasetRuleRole));
    return { ...table, permission: entry ? entry.permission : null };
  });
  if (!tables.some((t) => t.permission)) return { allowed: false, role };
  return admitted(row, role, tables, session, false);
}

const entryFor = (decision: DatasetReadDecision, table: DatasetTableName) => (decision.allowed ? decision.tables.find((t) => same(t, table)) : undefined);

/** The select rule for one table, or null when the role cannot read it. */
function selectFor(decision: DatasetReadDecision, table: DatasetTableName): DatasetSelectPermission | null {
  return entryFor(decision, table)?.permission ?? null;
}

/** May this role aggregate the table (the GraphQL aggregate fields)? */
export function canAggregate(decision: DatasetReadDecision, table: DatasetTableName): boolean {
  if (!decision.allowed) return false;
  if (decision.admin) return true;
  return !!selectFor(decision, table)?.allow_aggregations;
}

const notFound = () => new DatasetError('Dataset not found', 404);
/** Declared by the dataset (never a door's decoration, such as the page row ID). */
const declared = (decision: DatasetReadDecision, table: DatasetTableName) => entryFor(decision, table)?.columns ?? [];

/** A model (SQL) table the role may not read whole is answered empty: its SQL reads rows the rule cannot judge. */
const emptyModel = (table: DatasetTable): DatasetTable => ({ ...table, sql: `SELECT * FROM (${table.sql}) AS af_hidden_model WHERE 0` });

/**
 * The role view as `executeCatalog` takes it (lib/datasets `CatalogRowView`), or null when it changes
 * nothing. Hidden columns leave the catalog (so a query cannot name, filter, sort or aggregate them);
 * hidden tables keep their shape with no rows; a connected (Postgres) catalog cannot be filtered here,
 * so a role it would restrict gets the uniform 404.
 */
export function datasetView(decision: DatasetReadDecision): CatalogRowView | null {
  if (!decision.allowed) throw notFound();
  if (decision.full) return null;
  const { session, identity } = decision;
  return {
    identity,
    catalog(catalog: DatasetCatalog): DatasetCatalog {
      if (catalog.kind !== 'stored') throw notFound();
      return {
        ...catalog,
        tables: catalog.tables.map((table) => {
          const permission = selectFor(decision, table);
          if (table.sql !== undefined) return permission && unrestricted(permission) ? table : emptyModel(table);
          if (!permission || permission.columns === '*') return table;
          return { ...table, columns: table.columns.filter((c) => shows(permission, c.name)) };
        }),
      };
    },
    rows(table: DatasetTable, rows: Record<string, unknown>[]): Record<string, unknown>[] {
      const permission = selectFor(decision, table);
      if (!permission) return [];
      return viewRows(rows, declared(decision, table), permission, session, table.objectKey);
    },
  };
}

/**
 * The catalog this role may see, for doors that describe it (schemas, definitions, the raw catalog): hidden
 * columns removed and tables it cannot select left out. Execution keeps those tables, empty, so model SQL
 * naming them stays valid. The uniform 404 when it may see none.
 */
export function viewCatalog<T extends DatasetCatalog>(decision: DatasetReadDecision, catalog: T): T {
  const view = datasetView(decision);
  if (!view) return catalog;
  const viewed = view.catalog(catalog);
  return { ...catalog, tables: viewed.tables.filter((table) => selectFor(decision, table)) };
}

/**
 * One stored table's rows as this role may see them, loaded from the dataset row (the head, or an
 * archived revision's metadata). Without a table: the flat dataset's `public.rows`.
 */
export async function datasetRowsFor(decision: DatasetReadDecision, row: { meta: unknown }, table: DatasetTableName = { schema: 'public', name: 'rows' }): Promise<Record<string, unknown>[]> {
  const view = datasetView(decision);
  const meta = (row.meta ?? {}) as { objectKey?: unknown };
  const stored = catalogOf(row)?.tables.find((t) => same(t, table));
  const objectKey = stored?.objectKey ?? (typeof meta.objectKey === 'string' ? meta.objectKey : undefined);
  const rows = await loadDatasetRows({ meta: { objectKey } });
  if (!view) return rows;
  const shape: DatasetTable = stored ?? { schema: table.schema, name: table.name, columns: ((meta as { columns?: DatasetTable['columns'] }).columns ?? []), ...(objectKey ? { objectKey } : {}) };
  return view.rows(shape, rows);
}

/** A dataset may be exported as an image (a keyed render serves every row) only to a role that sees it whole. */
export function datasetExportable(decision: DatasetReadDecision): boolean {
  return decision.allowed && decision.full;
}

/**
 * A reader's dataset wire (the artifact GET, the content door): the rows, columns, counts and catalog this
 * role may see. Unchanged for a role that sees every row.
 */
export async function viewDatasetWire(decision: DatasetReadDecision, row: { meta: unknown }, wire: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!decision.allowed) throw notFound();
  if (decision.full) return wire;
  const rows = await datasetRowsFor(decision, row);
  const flat = selectFor(decision, { schema: 'public', name: 'rows' });
  const columns = Array.isArray(wire.columns) ? (wire.columns as Array<{ name?: unknown }>).filter((c) => !!flat && typeof c?.name === 'string' && shows(flat, c.name)) : wire.columns;
  const { totalRows: _total, truncated: _truncated, ...rest } = wire;
  const meta = (rest.meta ?? null) as { catalog?: DatasetCatalog } | null;
  return { ...rest, ...(meta?.catalog ? { meta: { ...meta, catalog: viewCatalog(decision, meta.catalog) } } : {}), columns, rowCount: rows.length, rows };
}
