/** DEPRECATED: GraphQL compatibility for pages published before SQL. Do not use in new code; do not extend. */
/**
 * THE GENERATED READ SCHEMA for one role: only the columns the role may select appear anywhere (row type,
 * bool_exp, order_by); there are no aggregate roots or types for any role (counts and totals are the page's
 * `_sql`); `_id: ID!` is the row identity. The SDL is valid GraphQL; without write rules it has a query root only.
 */
import { buildSchema, type GraphQLObjectType } from 'graphql';
import { describe, expect, it } from 'vitest';
import { hasuraSdl, type HasuraColumn, type HasuraTableModel } from '../dataset/hasura-schema';

const ORDERS: HasuraTableModel = {
  root: 'orders', table: { schema: 'public', name: 'rows' },
  columns: [
    { field: 'region', source: 'Region', type: 'String' },
    { field: 'amount', source: 'amount', type: 'Float' },
    { field: 'paid', source: 'paid', type: 'Boolean' },
  ],
};
const VIEWER: HasuraTableModel = { ...ORDERS, columns: [ORDERS.columns[0]!] };
/** Every selectable row type's `_can` (what this viewer may change), for every role alike. */
const CAN = '"May this viewer change or delete this row (its rule exists and its filter holds)? Advisory: writes are still judged." _can: orders_row_can!';

describe('the read SDL', () => {
  it('owner: every column, Hasura-shaped inputs, no aggregate root', () => {
    expect(hasuraSdl([ORDERS])).toBe(`enum order_by { asc asc_nulls_first asc_nulls_last desc desc_nulls_first desc_nulls_last }
input ID_comparison_exp { _eq: ID _neq: ID _in: [ID!] _nin: [ID!] }
input String_comparison_exp { _eq: String _neq: String _gt: String _gte: String _lt: String _lte: String _in: [String!] _nin: [String!] _is_null: Boolean _like: String _nlike: String _ilike: String _nilike: String }
input Float_comparison_exp { _eq: Float _neq: Float _gt: Float _gte: Float _lt: Float _lte: Float _in: [Float!] _nin: [Float!] _is_null: Boolean }
input Boolean_comparison_exp { _eq: Boolean _neq: Boolean _gt: Boolean _gte: Boolean _lt: Boolean _lte: Boolean _in: [Boolean!] _nin: [Boolean!] _is_null: Boolean }
type orders { _id: ID! region: String amount: Float paid: Boolean ${CAN} }
type orders_row_can { update: Boolean! delete: Boolean! }
type orders_can { insert: Boolean! }
input orders_bool_exp { _and: [orders_bool_exp!] _or: [orders_bool_exp!] _not: orders_bool_exp _id: ID_comparison_exp region: String_comparison_exp amount: Float_comparison_exp paid: Boolean_comparison_exp }
input orders_order_by { _id: order_by region: order_by amount: order_by paid: order_by }
type Query {
  orders(where: orders_bool_exp, order_by: [orders_order_by!], limit: Int, offset: Int): [orders!]!
  orders_by_pk(_id: ID!): orders
  "May this viewer add rows? Advisory: writes are still judged." orders_can: orders_can!
}
`);
    const schema = buildSchema(hasuraSdl([ORDERS]));
    expect(schema.getMutationType()).toBeUndefined();
    expect(schema.getSubscriptionType()).toBeUndefined();
  });

  it('viewer: hidden columns are absent everywhere', () => {
    const sdl = hasuraSdl([VIEWER]);
    expect(sdl).not.toMatch(/\bamount\b|\bpaid\b|_aggregate|_sum_fields/);
    expect(sdl).toContain(`type orders { _id: ID! region: String ${CAN} }`);
    expect(sdl).toContain('input orders_bool_exp { _and: [orders_bool_exp!] _or: [orders_bool_exp!] _not: orders_bool_exp _id: ID_comparison_exp region: String_comparison_exp }');
    expect(sdl).toContain('orders_by_pk(_id: ID!): orders');
    buildSchema(sdl);
  });

  it('a role that sees no columns still gets row identity', () => {
    const sdl = hasuraSdl([{ ...ORDERS, columns: [] }]);
    expect(sdl).toContain(`type orders { _id: ID! ${CAN} }`);
    expect(sdl).not.toMatch(/aggregate|_select_column|_sum_fields/);
    buildSchema(sdl);
  });

  it('several tables share one prelude', () => {
    const sdl = hasuraSdl([ORDERS, { ...VIEWER, root: 'customers', table: { schema: 'public', name: 'customers' } }]);
    expect(sdl.match(/enum order_by/g)).toHaveLength(1);
    expect(buildSchema(sdl).getQueryType()!.getFields()).toHaveProperty('customers_by_pk');
  });
});

/**
 * THE GENERATED MUTATION ROOT for one role: each root exists only when the role has that rule, and its inputs
 * name only the columns the rule allows (less the rule's presets). `returning`, `_one` and `_by_pk` need the
 * select rule (Hasura's own rule); a role that can write but read nothing has Hasura's `no_queries_available`.
 */
describe('the mutation SDL', () => {
  const [region, amount, paid] = ORDERS.columns as [HasuraColumn, HasuraColumn, HasuraColumn];
  it('owner: every root, every column, _inc for numeric columns, returning the row type', () => {
    const sdl = hasuraSdl([{ ...ORDERS, write: { insert: ORDERS.columns, update: ORDERS.columns, delete: true } }]);
    expect(sdl).toContain(`input orders_insert_input { region: String amount: Float paid: Boolean }
input orders_set_input { region: String amount: Float paid: Boolean }
input orders_inc_input { amount: Float }
input orders_pk_columns_input { _id: ID! }
type orders_mutation_response { affected_rows: Int! returning: [orders!]! }`);
    expect(sdl).toContain(`type Mutation {
  insert_orders(objects: [orders_insert_input!]!): orders_mutation_response
  insert_orders_one(object: orders_insert_input!): orders
  update_orders(where: orders_bool_exp!, _set: orders_set_input, _inc: orders_inc_input): orders_mutation_response
  update_orders_by_pk(pk_columns: orders_pk_columns_input!, _set: orders_set_input, _inc: orders_inc_input): orders
  delete_orders(where: orders_bool_exp!): orders_mutation_response
  delete_orders_by_pk(_id: ID!): orders
}`);
    const schema = buildSchema(sdl);
    expect(Object.keys(schema.getMutationType()!.getFields())).toHaveLength(6);
    expect(schema.getSubscriptionType()).toBeUndefined();
  });

  it('a rule role: inputs list only the rule\'s columns, which may be hidden from select; no rule, no root', () => {
    const sdl = hasuraSdl([{ ...VIEWER, write: { insert: [region, amount], update: [amount] } }]);
    expect(sdl).toContain('input orders_insert_input { region: String amount: Float }');
    expect(sdl).toContain('input orders_set_input { amount: Float }');
    expect(sdl).toContain('input orders_inc_input { amount: Float }');
    // The row type, where and returning still show only what the select rule shows.
    expect(sdl).toContain(`type orders { _id: ID! region: String ${CAN} }`);
    expect(sdl).toContain('type orders_mutation_response { affected_rows: Int! returning: [orders!]! }');
    expect(sdl).not.toMatch(/delete_orders|paid/);
    expect(Object.keys(buildSchema(sdl).getMutationType()!.getFields())).toEqual(['insert_orders', 'insert_orders_one', 'update_orders', 'update_orders_by_pk']);
  });

  it('a role that writes but selects nothing: affected_rows only, no _one/_by_pk, where on _id alone', () => {
    const sdl = hasuraSdl([{ ...ORDERS, select: false, columns: [], write: { insert: [region], delete: true } }]);
    expect(sdl).not.toMatch(/type orders \{|returning|_one|_by_pk|_order_by|_aggregate|_can/);
    expect(sdl).toContain('type orders_mutation_response { affected_rows: Int! }');
    expect(sdl).toContain('input orders_bool_exp { _and: [orders_bool_exp!] _or: [orders_bool_exp!] _not: orders_bool_exp _id: ID_comparison_exp }');
    expect(sdl).toContain('type Query {\n  no_queries_available: String!\n}');
    const schema = buildSchema(sdl);
    expect(Object.keys(schema.getMutationType()!.getFields())).toEqual(['insert_orders', 'delete_orders']);
  });

  it('a rule with nothing left to name has no root: every insert column preset, only boolean columns to increment', () => {
    const sdl = hasuraSdl([{ ...ORDERS, write: { insert: [], update: [paid] } }]);
    expect(sdl).not.toMatch(/insert_orders|orders_insert_input|orders_inc_input|_inc:/);
    expect(sdl).toContain('update_orders(where: orders_bool_exp!, _set: orders_set_input): orders_mutation_response');
    buildSchema(sdl);
  });
});

/**
 * WHAT THE VIEWER MAY CHANGE: `_can` on every selectable row type and `<root>_can` on the query root exist for every
 * role (a document asking them validates for every reader; a role without the rule reads false). A column can never
 * be named `_can`: the schema refuses to build rather than shadow it.
 */
describe('the capability fields', () => {
  it('are the same for a role with every rule and a role with none', () => {
    const owner = buildSchema(hasuraSdl([{ ...ORDERS, write: { insert: ORDERS.columns, update: ORDERS.columns, delete: true }, can: { insert: true, update: true, delete: true } }]));
    const reader = buildSchema(hasuraSdl([VIEWER]));
    for (const schema of [owner, reader]) {
      expect(String(schema.getQueryType()!.getFields().orders_can!.type)).toBe('orders_can!');
      expect(String((schema.getType('orders') as GraphQLObjectType).getFields()._can!.type)).toBe('orders_row_can!');
      expect(Object.keys((schema.getType('orders_row_can') as GraphQLObjectType).getFields())).toEqual(['update', 'delete']);
      expect(Object.keys((schema.getType('orders_can') as GraphQLObjectType).getFields())).toEqual(['insert']);
    }
  });

  it('refuses a column whose field would shadow _can or _id', () => {
    expect(() => hasuraSdl([{ ...ORDERS, columns: [{ field: '_can', source: '_can', type: 'String' }] }])).toThrow(/graphql_field_collision/);
    expect(() => hasuraSdl([{ ...ORDERS, columns: [{ field: '_id', source: 'id', type: 'String' }] }])).toThrow(/graphql_field_collision/);
  });
});
