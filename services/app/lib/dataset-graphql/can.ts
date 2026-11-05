/**
 * WHAT THE VIEWER MAY CHANGE: the answers behind `<root>_can { insert }` and a row's `_can { update delete }`
 * (./hasura-schema `HasuraCan`), so a page draws only the controls that would work. Advisory: every write is
 * still judged by the write path.
 *
 *  - A constant answer (owner and editor, no usable rule, an empty filter) costs nothing.
 *  - A rule's filter is decided in the SAME read as the row: one boolean expression per asked field, compiled by the
 *    write engine's own compiler (utils `compilePolicyPredicate`) over the role view's columns and `_id`. It fails
 *    closed: a filter naming a column the role cannot read, or a session value the caller lacks (signed out under a
 *    rule naming `X-Hasura-User-Id`), answers false without SQL; NULL is false.
 *  - Nothing is added unless the selection asks for `_can`, so a read that does not ask compiles exactly as before.
 *  - Rows a mutation returns are decided in memory by the role view's own evaluator (`admits`) over the same
 *    visible columns, so they answer as a read of them would.
 */
import { Kind, type FieldNode, type GraphQLResolveInfo, type SelectionSetNode } from 'graphql';
import type { DatasetBoolExp, Scalar } from '@artifactbin/contracts';
import { compilePolicyPredicate } from '@artifactbin/utils/dataset-policy';
import { ID_COLUMN, quote } from './model';
import { CAN_FIELD, type HasuraRowCan, type HasuraTableModel } from './hasura-schema';

type RowOperation = 'update' | 'delete';
const OPERATIONS: readonly RowOperation[] = ['update', 'delete'];
/** Which of a row's `_can` fields a selection asks for; null when it asks for no `_can`. */
export type CanAsked = Readonly<Record<RowOperation, boolean>> | null;

/** The fields named `name` in a selection set, through inline fragments and fragment spreads. */
function fieldsNamed(set: SelectionSetNode | undefined, name: string, info: Pick<GraphQLResolveInfo, 'fragments'>, seen: ReadonlySet<string> = new Set()): FieldNode[] {
  if (!set) return [];
  return set.selections.flatMap((node): FieldNode[] => {
    if (node.kind === Kind.FIELD) return node.name.value === name ? [node] : [];
    if (node.kind === Kind.INLINE_FRAGMENT) return fieldsNamed(node.selectionSet, name, info, seen);
    const fragment = seen.has(node.name.value) ? undefined : info.fragments[node.name.value];
    return fragment ? fieldsNamed(fragment.selectionSet, name, info, new Set([...seen, node.name.value])) : [];
  });
}

/** What the rows this resolver answers are asked for under `_can` (directives ignored: asking more is harmless). */
export function askedCan(info: Pick<GraphQLResolveInfo, 'fieldNodes' | 'fragments'> | undefined): CanAsked {
  if (!info) return null;
  const cans = info.fieldNodes.flatMap((node) => fieldsNamed(node.selectionSet, CAN_FIELD, info));
  if (!cans.length) return null;
  const asks = (op: RowOperation) => cans.some((can) => fieldsNamed(can.selectionSet, op, info).length > 0);
  return { update: asks('update'), delete: asks('delete') };
}

const alias = (op: RowOperation) => `_can_${op}`;
/** A rule's filter as SQL over the role view's columns, or null when it cannot hold there (fail closed). */
function filterSql(t: HasuraTableModel, rule: { filter: DatasetBoolExp; session: Readonly<Record<string, Scalar>> }, op: RowOperation) {
  try {
    return compilePolicyPredicate(rule.filter, [...t.columns.map((c) => c.source), ID_COLUMN], { ...rule.session }, `can_${op}`, { rowId: ID_COLUMN });
  } catch {
    return null;
  }
}

/** The select expressions the asked `_can` fields add to a row read (none for a constant answer); values into `params`. */
export function canSelect(t: HasuraTableModel, asked: CanAsked, params: Record<string, unknown>): string[] {
  if (!asked) return [];
  return OPERATIONS.flatMap((op) => {
    const can = t.can?.[op];
    if (!asked[op] || !can || can === true) return [];
    const compiled = filterSql(t, can, op);
    if (!compiled) return [];
    Object.assign(params, compiled.params);
    return [`CASE WHEN ${compiled.sql} THEN 1 ELSE 0 END AS ${quote(alias(op))}`];
  });
}

const constant = (can: HasuraRowCan | undefined) => can === true;
/** Rows as read (with `canSelect`'s columns) to GraphQL objects carrying `_can`; untouched when nothing asked. */
export function withCan(t: HasuraTableModel, asked: CanAsked, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (!asked) return rows;
  return rows.map((row) => {
    const { [alias('update')]: update, [alias('delete')]: del, ...rest } = row;
    const read = { update, delete: del } as Record<RowOperation, unknown>;
    const can = Object.fromEntries(OPERATIONS.map((op) => {
      const rule = t.can?.[op];
      return [op, typeof rule === 'object' ? asked[op] && Number(read[op] ?? 0) === 1 : constant(rule)];
    }));
    return { ...rest, [CAN_FIELD]: can };
  });
}

/** `_can` of a row a mutation returns, `visible` its role-view row (source columns and the row ID column). */
export function rowCan(t: HasuraTableModel, visible: Record<string, unknown>, admits: (filter: DatasetBoolExp, columns: readonly string[], row: Record<string, unknown>, session: Readonly<Record<string, Scalar>>) => boolean): Record<RowOperation, boolean> {
  const columns = [...t.columns.map((c) => c.source), ID_COLUMN];
  return Object.fromEntries(OPERATIONS.map((op) => {
    const rule = t.can?.[op];
    return [op, typeof rule === 'object' ? admits(rule.filter, columns, visible, rule.session) : constant(rule)];
  })) as Record<RowOperation, boolean>;
}

/** `<root>_can`: may this caller add rows? */
export const tableCan = (t: HasuraTableModel) => ({ insert: t.can?.insert === true });
