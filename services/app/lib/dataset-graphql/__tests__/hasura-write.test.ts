/**
 * THE MUTATION COMPILER: one generated mutation field to one row-addressed engine statement over the stored
 * table. Values are bound parameters, columns are the rule's writable source columns (looked up again by
 * GraphQL name), `_id` is generated and never written by the caller, and the row caps hold.
 */
import { describe, expect, it } from 'vitest';
import type { HasuraTableModel } from '../hasura-schema';
import { compileMutation, HasuraWriteError, mutationRoots } from '../hasura-write';

const region = { field: 'region', source: 'Region', type: 'String' as const };
const amount = { field: 'amount', source: 'amount', type: 'Float' as const };
const paid = { field: 'paid', source: 'paid', type: 'Boolean' as const };
const T: HasuraTableModel = {
  root: 'orders', table: { schema: 'public', name: 'rows' }, columns: [region, amount],
  write: { insert: [region, amount, paid], update: [region, amount], delete: true },
};
const ids = (i: number) => `r_${i}`;
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof HasuraWriteError) return [e.code, e.message]; throw e; } return null; };

describe('roots', () => {
  it('names each generated root field with its table and kind, only for rules the model has', () => {
    const roots = mutationRoots([T, { ...T, root: 'notes', table: { schema: 'public', name: 'notes' }, select: false, columns: [], write: { delete: true } }]);
    expect([...roots.keys()]).toEqual(['insert_orders', 'insert_orders_one', 'update_orders', 'update_orders_by_pk', 'delete_orders', 'delete_orders_by_pk', 'delete_notes']);
    expect(roots.get('update_orders_by_pk')).toMatchObject({ kind: 'update_by_pk', model: { root: 'orders' } });
  });
});

describe('insert', () => {
  it('one multi-row INSERT naming the union of columns, absent ones NULL, with generated _ids', () => {
    expect(compileMutation(T, 'insert', { objects: [{ region: 'west', amount: 3 }, { paid: true }] }, ids)).toEqual({
      sql: 'INSERT INTO "public"."rows" ("Region", "amount", "paid", "__af_graphql_row_id") VALUES ($v0_0, $v0_1, $v0_2, $id0), ($v1_0, $v1_1, $v1_2, $id1)',
      params: { v0_0: 'west', v0_1: 3, v0_2: null, id0: 'r_0', v1_0: null, v1_1: null, v1_2: true, id1: 'r_1' },
    });
    expect(compileMutation(T, 'insert_one', { object: {} }, ids)).toEqual({ sql: 'INSERT INTO "public"."rows" ("__af_graphql_row_id") VALUES ($id0)', params: { id0: 'r_0' } });
    expect(compileMutation(T, 'insert', { objects: [] }, ids)).toBeNull();
  });

  it('refuses _id, a column outside the rule, a mistyped value and more than 100 objects', () => {
    expect(refusal(() => compileMutation(T, 'insert_one', { object: { _id: 'x' } }, ids))).toEqual(['validation_failed', 'orders_insert_input has no field _id']);
    expect(refusal(() => compileMutation({ ...T, write: { insert: [region] } }, 'insert_one', { object: { amount: 1 } }, ids))).toEqual(['validation_failed', 'orders_insert_input has no field amount']);
    expect(refusal(() => compileMutation(T, 'insert_one', { object: { amount: 'lots' } }, ids))?.[0]).toBe('validation_failed');
    expect(refusal(() => compileMutation(T, 'insert_one', { object: { amount: Number.NaN } }, ids))?.[0]).toBe('validation_failed');
    expect(refusal(() => compileMutation(T, 'insert', { objects: Array.from({ length: 101 }, () => ({})) }, ids))?.[0]).toBe('too_many_rows');
  });
});

describe('update', () => {
  it('_set binds values, _inc adds to the stored value, where compiles as in reads', () => {
    expect(compileMutation(T, 'update', { where: { region: { _eq: 'west' } }, _set: { region: 'east' }, _inc: { amount: 2 } }, ids)).toEqual({
      sql: 'UPDATE "public"."rows" SET "Region" = $s0, "amount" = "amount" + $i0 WHERE (("Region" = $w0))',
      params: { s0: 'east', i0: 2, w0: 'west' },
    });
    expect(compileMutation(T, 'update_by_pk', { pk_columns: { _id: 'r_9' }, _set: { amount: null } }, ids)).toEqual({
      sql: 'UPDATE "public"."rows" SET "amount" = $s0 WHERE "__af_graphql_row_id" = $pk',
      params: { s0: null, pk: 'r_9' },
    });
    expect(compileMutation(T, 'update', { where: {}, _set: { region: 'x' } }, ids)!.sql).toBe('UPDATE "public"."rows" SET "Region" = $s0 WHERE (1=1)');
  });

  it('refuses no change, a column both set and incremented, a null or non-numeric _inc, and a hidden where column', () => {
    expect(refusal(() => compileMutation(T, 'update', { where: {} }, ids))?.[0]).toBe('validation_failed');
    expect(refusal(() => compileMutation(T, 'update', { where: {}, _set: {} }, ids))?.[0]).toBe('validation_failed');
    expect(refusal(() => compileMutation(T, 'update', { where: {}, _set: { amount: 1 }, _inc: { amount: 1 } }, ids))?.[0]).toBe('validation_failed');
    expect(refusal(() => compileMutation(T, 'update', { where: {}, _inc: { amount: null } }, ids))?.[0]).toBe('validation_failed');
    expect(refusal(() => compileMutation(T, 'update', { where: {}, _inc: { region: 1 } }, ids))?.[0]).toBe('validation_failed');
    expect(refusal(() => compileMutation(T, 'update', { where: { paid: { _eq: true } }, _set: { region: 'x' } }, ids))?.[0]).toBe('validation_failed');
  });
});

describe('delete', () => {
  it('compiles where and _by_pk', () => {
    expect(compileMutation(T, 'delete', { where: { amount: { _lt: 0 } } }, ids)).toEqual({ sql: 'DELETE FROM "public"."rows" WHERE (("amount" < $w0))', params: { w0: 0 } });
    expect(compileMutation(T, 'delete_by_pk', { _id: 'r_1' }, ids)).toEqual({ sql: 'DELETE FROM "public"."rows" WHERE "__af_graphql_row_id" = $pk', params: { pk: 'r_1' } });
  });
});
