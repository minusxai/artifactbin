/** DEPRECATED: GraphQL compatibility for pages published before SQL. Do not use in new code; do not extend. */
/**
 * GENERATED GRAPHQL NAMES: a column keeps a valid, unreserved name; anything else is normalized (lower-case,
 * non-alphanumeric runs to `_`, trimmed, `c_` before a digit) and collisions take `_2`, `_3`. A name stored in
 * `configuration.custom_column_names` always wins and is never recomputed; a stored name is never reused for
 * another column, even after its column is gone. Roots follow the same rules and never collide with another
 * root's generated fields or the shared types.
 */
import { describe, expect, it } from 'vitest';
import { hasuraColumnNames, hasuraRootNames } from '../dataset/hasura-names';

describe('column names', () => {
  it('keeps valid names and normalizes the rest', () => {
    expect(hasuraColumnNames(['region', 'Amount', 'Created By', 'Unit Price ($)', '2024 total', 'naïve', '***'])).toEqual({
      region: 'region', Amount: 'Amount', 'Created By': 'created_by', 'Unit Price ($)': 'unit_price', '2024 total': 'c_2024_total', 'naïve': 'na_ve', '***': 'column',
    });
  });

  it('never takes a reserved name: _id, _and, _or, _not, __*, and the GraphQL literals', () => {
    expect(hasuraColumnNames(['_id', '_and', '_or', '_not', '__typename', 'true', 'null', 'id'])).toEqual({
      _id: 'id_2', _and: 'and', _or: 'or', _not: 'not', __typename: 'typename', true: 'true_2', null: 'null_2', id: 'id',
    });
  });

  it('settles collisions with _2, _3, and a valid name wins over a normalized one whatever the column order', () => {
    expect(hasuraColumnNames(['Created By', 'created_by', 'created-by'])).toEqual({ created_by: 'created_by', 'Created By': 'created_by_2', 'created-by': 'created_by_3' });
    expect(hasuraColumnNames(['created_by', 'Created By'])).toEqual({ created_by: 'created_by', 'Created By': 'created_by_2' });
    expect(hasuraColumnNames(['a_2', 'A', 'a', 'a!'])).toEqual({ a_2: 'a_2', A: 'A', a: 'a', 'a!': 'a_3' });
  });

  it('a stored name wins and is never recomputed', () => {
    const first = hasuraColumnNames(['Created By', 'amount']);
    expect(first).toEqual({ 'Created By': 'created_by', amount: 'amount' });
    // The next revision adds a column whose own name is the stored one: the stored mapping stays.
    expect(hasuraColumnNames(['created_by', 'Created By', 'amount'], first)).toEqual({ 'Created By': 'created_by', created_by: 'created_by_2', amount: 'amount' });
  });

  it('a stored name of a dropped column is never handed to another column', () => {
    expect(hasuraColumnNames(['amount'], { Amount: 'amount' })).toEqual({ amount: 'amount_2' });
  });

  it('ignores a stored name that is not a valid, unreserved, unique GraphQL name', () => {
    expect(hasuraColumnNames(['a b', 'c d', 'e'], { 'a b': 'not valid', 'c d': '_id', e: 'x' })).toEqual({ 'a b': 'a_b', 'c d': 'c_d', e: 'x' });
    expect(hasuraColumnNames(['p', 'q'], { p: 'same', q: 'same' })).toEqual({ p: 'same', q: 'q' });
  });

  it('is stable when an unrelated column is dropped or the columns are reordered', () => {
    const names = hasuraColumnNames(['Region', 'region name', 'x', 'region_name']);
    expect(hasuraColumnNames(['region_name', 'region name', 'Region'])).toEqual({ Region: names.Region, 'region name': names['region name'], region_name: names.region_name });
  });
});

describe('root names', () => {
  it('a flat dataset is named by its configuration, else its title, else "data"', () => {
    const flat = [{ schema: 'public', name: 'rows' }];
    expect(hasuraRootNames(flat, { title: 'Q3 Orders!' })).toEqual(['q3_orders']);
    expect(hasuraRootNames(flat, { title: 'Q3 Orders!', configuration: () => ({ custom_name: 'signups' }) })).toEqual(['signups']);
    expect(hasuraRootNames(flat, { title: '  ' })).toEqual(['data']);
    expect(hasuraRootNames(flat, { title: '2024' })).toEqual(['c_2024']);
  });

  it('a multi-table dataset is named by its tables', () => {
    expect(hasuraRootNames([{ schema: 'public', name: 'customers' }, { schema: 'public', name: 'Orders' }], { title: 'Shop' })).toEqual(['customers', 'Orders']);
  });

  it('never collides with another root, its generated fields or types, or a shared type', () => {
    const t = (...names: string[]) => names.map((name) => ({ schema: 'public', name }));
    // insert_orders_2 is already orders_2's insert root.
    expect(hasuraRootNames(t('orders', 'Orders!', 'orders_by_pk', 'insert_orders'), {})).toEqual(['orders', 'orders_2', 'orders_by_pk_2', 'insert_orders_3']);
    expect(hasuraRootNames(t('order_by', 'String', 'Query', 'Float_comparison_exp'), {})).toEqual(['order_by_2', 'String_2', 'Query_2', 'Float_comparison_exp_2']);
    expect(hasuraRootNames(t('a', 'b'), { configuration: () => ({ custom_name: 'same' }) })).toEqual(['same', 'same_2']);
  });

  it('never meets another root\'s capability names (`<root>_can`, `<root>_row_can`), and no column is named _can', () => {
    const t = (...names: string[]) => names.map((name) => ({ schema: 'public', name }));
    expect(hasuraRootNames(t('tasks', 'tasks_can', 'tasks_row_can'), {})).toEqual(['tasks', 'tasks_can_2', 'tasks_row_can_2']);
    expect(hasuraColumnNames(['_can', 'can'])).toEqual({ _can: 'can_2', can: 'can' });
  });
});
