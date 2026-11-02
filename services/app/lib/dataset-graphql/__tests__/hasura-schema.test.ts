/**
 * THE GENERATED READ SCHEMA for one role: only the columns the role may select appear anywhere (row type,
 * bool_exp, order_by, select_column, aggregate fields); `_aggregate` exists only with allow_aggregations;
 * `_id: ID!` is the row identity. The SDL is valid GraphQL and has a query root only.
 */
import { buildSchema } from 'graphql';
import { describe, expect, it } from 'vitest';
import { hasuraSdl, type HasuraTableModel } from '../hasura-schema';

const ORDERS: HasuraTableModel = {
  root: 'orders', table: { schema: 'public', name: 'rows' }, aggregations: true,
  columns: [
    { field: 'region', source: 'Region', type: 'String' },
    { field: 'amount', source: 'amount', type: 'Float' },
    { field: 'paid', source: 'paid', type: 'Boolean' },
  ],
};
const VIEWER: HasuraTableModel = { ...ORDERS, aggregations: false, columns: [ORDERS.columns[0]!] };

describe('the read SDL', () => {
  it('owner: every column, the aggregate root, Hasura-shaped inputs', () => {
    expect(hasuraSdl([ORDERS])).toBe(`enum order_by { asc asc_nulls_first asc_nulls_last desc desc_nulls_first desc_nulls_last }
input ID_comparison_exp { _eq: ID _neq: ID _in: [ID!] _nin: [ID!] }
input String_comparison_exp { _eq: String _neq: String _gt: String _gte: String _lt: String _lte: String _in: [String!] _nin: [String!] _is_null: Boolean _like: String _nlike: String _ilike: String _nilike: String }
input Float_comparison_exp { _eq: Float _neq: Float _gt: Float _gte: Float _lt: Float _lte: Float _in: [Float!] _nin: [Float!] _is_null: Boolean }
input Boolean_comparison_exp { _eq: Boolean _neq: Boolean _gt: Boolean _gte: Boolean _lt: Boolean _lte: Boolean _in: [Boolean!] _nin: [Boolean!] _is_null: Boolean }
type orders { _id: ID! region: String amount: Float paid: Boolean }
input orders_bool_exp { _and: [orders_bool_exp!] _or: [orders_bool_exp!] _not: orders_bool_exp _id: ID_comparison_exp region: String_comparison_exp amount: Float_comparison_exp paid: Boolean_comparison_exp }
input orders_order_by { _id: order_by region: order_by amount: order_by paid: order_by }
enum orders_select_column { region amount paid }
type orders_aggregate { aggregate: orders_aggregate_fields nodes: [orders!]! }
type orders_aggregate_fields { count(columns: [orders_select_column!], distinct: Boolean): Int! sum: orders_sum_fields avg: orders_avg_fields max: orders_max_fields min: orders_min_fields }
type orders_sum_fields { amount: Float }
type orders_avg_fields { amount: Float }
type orders_max_fields { region: String amount: Float }
type orders_min_fields { region: String amount: Float }
type Query {
  orders(where: orders_bool_exp, order_by: [orders_order_by!], limit: Int, offset: Int): [orders!]!
  orders_by_pk(_id: ID!): orders
  orders_aggregate(where: orders_bool_exp, order_by: [orders_order_by!], limit: Int, offset: Int): orders_aggregate!
}
`);
    const schema = buildSchema(hasuraSdl([ORDERS]));
    expect(schema.getMutationType()).toBeUndefined();
    expect(schema.getSubscriptionType()).toBeUndefined();
  });

  it('viewer: hidden columns are absent everywhere and no aggregate without allow_aggregations', () => {
    const sdl = hasuraSdl([VIEWER]);
    expect(sdl).not.toMatch(/\bamount\b|\bpaid\b|_aggregate|_sum_fields/);
    expect(sdl).toContain('type orders { _id: ID! region: String }');
    expect(sdl).toContain('input orders_bool_exp { _and: [orders_bool_exp!] _or: [orders_bool_exp!] _not: orders_bool_exp _id: ID_comparison_exp region: String_comparison_exp }');
    expect(sdl).toContain('orders_by_pk(_id: ID!): orders');
    buildSchema(sdl);
  });

  it('a role that sees no columns still gets row identity; aggregate types without eligible columns are left out', () => {
    const sdl = hasuraSdl([{ ...ORDERS, columns: [] }]);
    expect(sdl).toContain('type orders { _id: ID! }');
    expect(sdl).not.toMatch(/orders_select_column|orders_sum_fields|orders_min_fields/);
    expect(sdl).toContain('type orders_aggregate_fields { count: Int! }');
    buildSchema(sdl);
  });

  it('several tables share one prelude', () => {
    const sdl = hasuraSdl([ORDERS, { ...VIEWER, root: 'customers', table: { schema: 'public', name: 'customers' } }]);
    expect(sdl.match(/enum order_by/g)).toHaveLength(1);
    expect(buildSchema(sdl).getQueryType()!.getFields()).toHaveProperty('customers_by_pk');
  });
});
