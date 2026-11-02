import { describe, expect, it } from 'vitest';
import {
  DATASET_PERMISSION_LIMITS,
  DATASET_PERMISSION_TEMPLATES,
  DATASET_ROLES,
  datasetRoleAtLeast,
  type DatasetPermissions,
  type DatasetPermissionsShape,
} from '@artifactbin/contracts';
import {
  datasetPermissionsTemplate,
  readBackDatasetPermissions,
  validateDatasetPermissions,
} from '@artifactbin/utils/dataset-permissions';
import backendOnly from './fixtures/hasura/backend-only.json';
import columnLevel from './fixtures/hasura/column-level.json';
import columnPresets from './fixtures/hasura/column-presets.json';
import planSignups from './fixtures/hasura/plan-signups.json';
import refusedExists from './fixtures/hasura/refused-exists.json';
import refusedMetadataApiShorthand from './fixtures/hasura/refused-metadata-api-shorthand.json';
import refusedMetadataApiUpdate from './fixtures/hasura/refused-metadata-api-update.json';
import refusedMetadataFormat from './fixtures/hasura/refused-metadata-format.json';
import refusedRelationship from './fixtures/hasura/refused-relationship.json';
import refusedSessionArray from './fixtures/hasura/refused-session-array.json';
import rowLevelAndIlike from './fixtures/hasura/row-level-and-ilike.json';
import rowLevelPrice from './fixtures/hasura/row-level-price.json';
import rowLevelSession from './fixtures/hasura/row-level-session.json';

interface Fixture {
  source: string;
  columns: string[];
  table: { table: { schema: string; name: string }; [key: string]: unknown };
}
const FIXTURES: Record<string, unknown> = {
  'backend-only': backendOnly,
  'column-level': columnLevel,
  'column-presets': columnPresets,
  'plan-signups': planSignups,
  'refused-exists': refusedExists,
  'refused-metadata-api-shorthand': refusedMetadataApiShorthand,
  'refused-metadata-api-update': refusedMetadataApiUpdate,
  'refused-metadata-format': refusedMetadataFormat,
  'refused-relationship': refusedRelationship,
  'refused-session-array': refusedSessionArray,
  'row-level-and-ilike': rowLevelAndIlike,
  'row-level-price': rowLevelPrice,
  'row-level-session': rowLevelSession,
};
const fixture = (name: string) => FIXTURES[name] as Fixture;
const shapeOf = (f: Fixture): DatasetPermissionsShape => ({
  tables: [{ table: f.table.table, columns: f.columns }],
});
const wrap = (table: unknown) => ({ version: 3, tables: [table] });
/** Hasura's docs use the role `user`; ours is `signed_in`. Nothing else changes. */
const asSignedIn = (table: unknown) =>
  JSON.parse(JSON.stringify(table).replaceAll('"role":"user"', '"role":"signed_in"'));
const errorsOf = (value: unknown, shape?: DatasetPermissionsShape) => {
  const result = validateDatasetPermissions(value, shape);
  return result.ok ? [] : result.errors;
};
const ROLES = 'roles are viewer, signed_in, anonymous';
const OPERATORS =
  'operators are _eq, _neq, _gt, _gte, _lt, _lte, _in, _nin, _is_null, _like, _nlike, _ilike, _nilike';
const SESSION =
  'session variables are X-Hasura-User-Id, X-Hasura-Page-Id, X-Hasura-Role';
const rows = { schema: 'public', name: 'rows' };
const rowsShape: DatasetPermissionsShape = {
  tables: [{ table: rows, columns: ['name', 'shift', 'created_by'] }],
};
const one = (op: string, permission: unknown, role = 'signed_in') =>
  wrap({ table: rows, [`${op}_permissions`]: [{ role, permission }] });

describe('roles', () => {
  it('orders roles weakest first for the resolver "at least" reading', () => {
    expect(DATASET_ROLES).toEqual(['anonymous', 'signed_in', 'viewer', 'editor', 'owner']);
    expect(datasetRoleAtLeast('viewer', 'signed_in')).toBe(true);
    expect(datasetRoleAtLeast('signed_in', 'viewer')).toBe(false);
    expect(datasetRoleAtLeast('owner', 'owner')).toBe(true);
  });
});

describe('Hasura docs fixtures lock the grammar', () => {
  const accepted = [
    'row-level-price',
    'row-level-and-ilike',
    'row-level-session',
    'column-level',
    'column-presets',
    'backend-only',
  ];
  it.each(accepted)('%s: verbatim fails only on the role name', (name) => {
    const f = fixture(name);
    const errors = errorsOf(wrap(f.table), shapeOf(f));
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) {
      expect(e.path).toMatch(/\.role$/);
      expect(e.message).toBe(`unknown role "user"; ${ROLES}`);
    }
  });
  it.each(accepted)('%s: with role signed_in parses unchanged', (name) => {
    const f = fixture(name);
    const input = wrap(asSignedIn(f.table));
    expect(validateDatasetPermissions(input, shapeOf(f))).toEqual({ ok: true, policy: input });
    // Structure alone (no dataset columns) is enough to accept it too.
    expect(validateDatasetPermissions(input)).toEqual({ ok: true, policy: input });
  });
  it('keeps session variable spelling verbatim', () => {
    const f = fixture('column-presets');
    const result = validateDatasetPermissions(wrap(asSignedIn(f.table)), shapeOf(f));
    expect(result.ok && result.policy.tables[0]?.insert_permissions?.[0]?.permission.set)
      .toEqual({ id: 'x-hasura-User-Id' });
  });
  it('accepts the plan’s own signups policy as written', () => {
    const f = fixture('plan-signups');
    expect(validateDatasetPermissions(wrap(f.table), shapeOf(f)).ok).toBe(true);
  });

  const p = 'tables[0]';
  const refused: [string, { path: string; message: string }[]][] = [
    [
      'refused-session-array',
      [
        { path: `${p}.select_permissions[0].role`, message: `unknown role "user"; ${ROLES}` },
        {
          path: `${p}.select_permissions[0].permission.filter.user_id._in`,
          message: `unknown session variable "X-Hasura-Allowed-Ids"; ${SESSION}`,
        },
      ],
    ],
    [
      'refused-relationship',
      [
        { path: `${p}.select_permissions[0].role`, message: `unknown role "manager"; ${ROLES}` },
        {
          path: `${p}.select_permissions[0].permission.filter.usersInVendorsByVendorId`,
          message:
            'unknown column "usersInVendorsByVendorId"; columns are id, name, description, price, manufacturer, category, image, added_by_user_id',
        },
      ],
    ],
    [
      'refused-exists',
      [
        { path: `${p}.insert_permissions[0].role`, message: `unknown role "user"; ${ROLES}` },
        {
          path: `${p}.insert_permissions[0].permission.check._exists`,
          message: 'unsupported expression "_exists"; use _and, _or, _not or a column name',
        },
      ],
    ],
    [
      'refused-metadata-format',
      [
        { path: `${p}.array_relationships`, message: 'unsupported field "array_relationships"' },
        { path: `${p}.event_triggers`, message: 'unsupported field "event_triggers"' },
        { path: `${p}.select_permissions[0].role`, message: `unknown role "user"; ${ROLES}` },
        {
          path: `${p}.select_permissions[0].permission.query_root_fields`,
          message: 'unsupported field "query_root_fields"',
        },
        {
          path: `${p}.select_permissions[0].permission.subscription_root_fields`,
          message: 'unsupported field "subscription_root_fields"',
        },
        { path: `${p}.insert_permissions[0].role`, message: `unknown role "user"; ${ROLES}` },
        { path: `${p}.delete_permissions[0].role`, message: `unknown role "user"; ${ROLES}` },
      ],
    ],
    [
      'refused-metadata-api-shorthand',
      [
        { path: `${p}.insert_permissions[0].role`, message: `unknown role "user"; ${ROLES}` },
        {
          path: `${p}.insert_permissions[0].permission.check.author_id`,
          message: 'expected an operator object such as {"_eq": value}',
        },
        {
          path: `${p}.insert_permissions[0].permission.check.$or`,
          message: 'unsupported expression "$or"; use "_or"',
        },
      ],
    ],
    [
      'refused-metadata-api-update',
      [
        { path: `${p}.update_permissions[0].role`, message: `unknown role "user"; ${ROLES}` },
        {
          path: `${p}.update_permissions[0].permission.validate_input`,
          message: 'unsupported field "validate_input"',
        },
        {
          path: `${p}.update_permissions[0].permission.filter.author_id`,
          message: 'expected an operator object such as {"_eq": value}',
        },
        {
          path: `${p}.update_permissions[0].permission.check.content._ne`,
          message: `unsupported operator "_ne"; ${OPERATORS}`,
        },
      ],
    ],
  ];
  it.each(refused)('%s: every refusal is reported by path', (name, expected) => {
    const f = fixture(name);
    expect(errorsOf(wrap(f.table), shapeOf(f))).toEqual(expected);
  });
});

describe('validation errors name the bad role, table, column, operator or value', () => {
  const ep = (op: string) => `tables[0].${op}_permissions[0]`;
  const cases: [string, unknown, DatasetPermissionsShape | undefined, { path: string; message: string }[]][] = [
    [
      'unknown role (the plan’s example)',
      wrap({
        table: rows,
        update_permissions: [
          { role: 'viewer', permission: { columns: '*', filter: {} } },
          { role: 'members', permission: { columns: '*', filter: {} } },
        ],
      }),
      undefined,
      [{ path: 'tables[0].update_permissions[1].role', message: `unknown role "members"; ${ROLES}` }],
    ],
    [
      'owner rules are refused with the reason',
      one('select', { columns: '*', filter: {} }, 'owner'),
      undefined,
      [{ path: `${ep('select')}.role`, message: `owner always has full access, so rules cannot name it; ${ROLES}` }],
    ],
    [
      'editor rules are refused with the reason',
      one('delete', { filter: {} }, 'editor'),
      undefined,
      [{ path: `${ep('delete')}.role`, message: `editor always has full access, so rules cannot name it; ${ROLES}` }],
    ],
    [
      'one entry per role per operation',
      wrap({
        table: rows,
        delete_permissions: [
          { role: 'viewer', permission: { filter: {} } },
          { role: 'viewer', permission: { filter: {} } },
        ],
      }),
      undefined,
      [{ path: 'tables[0].delete_permissions[1].role', message: 'duplicate role "viewer"; one entry per role per operation' }],
    ],
    [
      'unknown column in columns, set and predicates',
      one('update', {
        columns: ['shift', 'amount'],
        filter: { owner: { _eq: 'X-Hasura-User-Id' } },
        set: { note: 'x' },
      }),
      rowsShape,
      [
        { path: `${ep('update')}.permission.columns[1]`, message: 'unknown column "amount"; columns are name, shift, created_by' },
        { path: `${ep('update')}.permission.filter.owner`, message: 'unknown column "owner"; columns are name, shift, created_by' },
        { path: `${ep('update')}.permission.set.note`, message: 'unknown column "note"; columns are name, shift, created_by' },
      ],
    ],
    [
      'the row ID is not a column to list or set, but may be compared',
      one('insert', { columns: ['_id'], check: { _id: { _gt: 'a' } }, set: { _id: 'x' } }),
      rowsShape,
      [
        { path: `${ep('insert')}.permission.columns[0]`, message: '"_id" is the row ID; it cannot be listed or set' },
        { path: `${ep('insert')}.permission.check._id._gt`, message: 'unsupported operator "_gt" for _id; operators are _eq, _neq, _in, _nin' },
        { path: `${ep('insert')}.permission.set._id`, message: '"_id" is the row ID; it cannot be listed or set' },
      ],
    ],
    [
      'unknown and duplicate tables',
      { version: 3, tables: [{ table: { schema: 'public', name: 'orders' } }, { table: rows }, { table: rows }] },
      rowsShape,
      [
        { path: 'tables[0].table', message: 'unknown table "public.orders"; tables are public.rows' },
        { path: 'tables[2].table', message: 'duplicate table "public.rows"' },
      ],
    ],
    [
      'unknown session variables, in any value position',
      one('insert', {
        check: { shift: { _in: ['X-Hasura-Org-Id'] } },
        set: { created_by: 'x-hasura-user-name' },
      }),
      undefined,
      [
        { path: `${ep('insert')}.permission.check.shift._in[0]`, message: `unknown session variable "X-Hasura-Org-Id"; ${SESSION}` },
        { path: `${ep('insert')}.permission.set.created_by`, message: `unknown session variable "x-hasura-user-name"; ${SESSION}` },
      ],
    ],
    [
      'operators: unsupported, $-prefixed, values, null and patterns',
      one('select', {
        columns: '*',
        filter: {
          name: { _regex: '.*', $eq: 'a' },
          shift: { _eq: null, _is_null: 'yes', _like: 3, _in: 'a' },
          created_by: { _gt: { a: 1 } },
          _not: [],
        },
      }),
      undefined,
      [
        { path: `${ep('select')}.permission.filter.name._regex`, message: `unsupported operator "_regex"; ${OPERATORS}` },
        { path: `${ep('select')}.permission.filter.name.$eq`, message: 'unsupported operator "$eq"; use "_eq"' },
        { path: `${ep('select')}.permission.filter.shift._eq`, message: 'null comparisons use _is_null' },
        { path: `${ep('select')}.permission.filter.shift._is_null`, message: 'expected true or false' },
        { path: `${ep('select')}.permission.filter.shift._like`, message: 'expected a text pattern' },
        { path: `${ep('select')}.permission.filter.shift._in`, message: 'expected an array of at most 100 values' },
        { path: `${ep('select')}.permission.filter.created_by._gt`, message: 'expected a string, number or boolean' },
        { path: `${ep('select')}.permission.filter._not`, message: 'expected an object' },
      ],
    ],
    [
      'required fields and field types',
      wrap({
        table: rows,
        select_permissions: [{ role: 'viewer', permission: { columns: 'all', limit: 5000, allow_aggregations: 'yes' } }],
        insert_permissions: [{ role: 'viewer', permission: { columns: ['name', 'name'], backend_only: 1 } }],
        update_permissions: [{ role: 'viewer', permission: { filter: {} }, comment: 7 }],
      }),
      undefined,
      [
        { path: 'tables[0].select_permissions[0].permission.columns', message: 'expected "*" or a list of column names' },
        { path: 'tables[0].select_permissions[0].permission.filter', message: 'required' },
        { path: 'tables[0].select_permissions[0].permission.limit', message: 'expected a whole number from 0 to 1000' },
        { path: 'tables[0].select_permissions[0].permission.allow_aggregations', message: 'expected true or false' },
        { path: 'tables[0].insert_permissions[0].permission.columns[1]', message: 'duplicate column "name"' },
        { path: 'tables[0].insert_permissions[0].permission.check', message: 'required' },
        { path: 'tables[0].insert_permissions[0].permission.backend_only', message: 'expected true or false' },
        { path: 'tables[0].update_permissions[0].comment', message: 'expected a string' },
        { path: 'tables[0].update_permissions[0].permission.columns', message: 'required' },
      ],
    ],
    [
      'document shape: version, unknown keys, configuration',
      {
        version: 2,
        enforcement: 'enabled',
        tables: [{ table: 'rows', configuration: { custom_name: 1, column_config: {} } }],
      },
      undefined,
      [
        { path: 'enforcement', message: 'unsupported field "enforcement"' },
        { path: 'version', message: 'expected 3' },
        { path: 'tables[0].table', message: 'expected {"schema": "…", "name": "…"}' },
        { path: 'tables[0].configuration.column_config', message: 'unsupported field "column_config"' },
        { path: 'tables[0].configuration.custom_name', message: 'expected a string' },
      ],
    ],
    ['not an object', [], undefined, [{ path: 'policy', message: 'expected an object' }]],
  ];
  it.each(cases)('%s', (_name, value, shape, expected) => {
    expect(errorsOf(value, shape)).toEqual(expected);
  });

  it('bounds size, table count, nesting depth, comparisons and _in values', () => {
    const big = { version: 3, tables: [{ table: rows, comment: 'x'.repeat(DATASET_PERMISSION_LIMITS.bytes) }] };
    expect(errorsOf(big)).toEqual([{ path: 'policy', message: 'larger than 64 KB' }]);
    const many = { version: 3, tables: Array.from({ length: 65 }, (_, i) => ({ table: { schema: 'public', name: `t${i}` } })) };
    expect(errorsOf(many)).toEqual([{ path: 'tables', message: 'expected an array of at most 64 tables' }]);
    let deep: Record<string, unknown> = { name: { _eq: 'a' } };
    for (let i = 0; i < 13; i++) deep = { _not: deep };
    expect(errorsOf(one('delete', { filter: deep }))).toEqual([
      { path: `${ep('delete')}.permission.filter${'._not'.repeat(13)}`, message: 'nesting deeper than 12' },
    ]);
    const wide = { _and: Array.from({ length: 65 }, () => ({ name: { _eq: 'a' } })) };
    expect(errorsOf(one('delete', { filter: wide }))).toEqual([
      { path: `${ep('delete')}.permission.filter`, message: 'more than 64 comparisons' },
    ]);
    const values = Array.from({ length: 101 }, (_, i) => i);
    expect(errorsOf(one('delete', { filter: { shift: { _in: values } } }))).toEqual([
      { path: `${ep('delete')}.permission.filter.shift._in`, message: 'expected an array of at most 100 values' },
    ]);
  });

  it('accepts every documented field and returns an independent copy', () => {
    const input = wrap({
      table: rows,
      configuration: { custom_name: 'signups', custom_column_names: { created_by: 'creator' } },
      select_permissions: [
        { role: 'viewer', permission: { columns: '*', filter: { _or: [{ shift: { _gte: 1, _lte: 3 } }, { name: { _nilike: 'a%' } }] }, limit: 1000, allow_aggregations: false }, comment: null },
      ],
      insert_permissions: [{ role: 'signed_in', permission: { check: { _not: { name: { _is_null: true } } }, set: { created_by: 'X-HASURA-USER-ID', shift: 1 }, backend_only: true } }],
      update_permissions: [{ role: 'signed_in', permission: { columns: ['shift'], filter: { _id: { _in: ['a', 'b'] } }, check: null, backend_only: false } }],
      delete_permissions: [{ role: 'anonymous', permission: { filter: { name: { _nin: ['x'], _neq: 'y', _lt: 'z', _gt: 'a', _like: 'a%', _nlike: 'b%', _ilike: 'c%' } } }, comment: 'cleanup' }],
    });
    const result = validateDatasetPermissions(input, rowsShape);
    expect(result).toEqual({ ok: true, policy: input });
    if (result.ok) expect(result.policy).not.toBe(input);
  });
});

describe('templates', () => {
  it('lists the three templates', () => {
    expect(DATASET_PERMISSION_TEMPLATES).toEqual(['read-only', 'own-rows', 'editors-only']);
  });
  const all = { columns: '*', filter: {}, allow_aggregations: true };
  const readAll = ['viewer', 'signed_in', 'anonymous'].map((role) => ({ role, permission: all }));
  const own = { created_by: { _eq: 'X-Hasura-User-Id' } };
  const cases: [string, string | undefined, DatasetPermissions][] = [
    ['read-only', undefined, { version: 3, tables: [{ table: rows, select_permissions: readAll }] } as DatasetPermissions],
    [
      'own-rows',
      'created_by',
      {
        version: 3,
        tables: [
          {
            table: rows,
            select_permissions: readAll,
            insert_permissions: ['viewer', 'signed_in'].map((role) => ({
              role,
              permission: { columns: ['name', 'shift'], check: {}, set: { created_by: 'X-Hasura-User-Id' } },
            })),
            update_permissions: ['viewer', 'signed_in'].map((role) => ({
              role,
              permission: { columns: ['name', 'shift'], filter: own, check: own },
            })),
            delete_permissions: ['viewer', 'signed_in'].map((role) => ({ role, permission: { filter: own } })),
          },
        ],
      } as DatasetPermissions,
    ],
    ['editors-only', undefined, { version: 3, tables: [{ table: rows }] }],
  ];
  it.each(cases)('%s generates the planned rules and passes validation', (name, ownerColumn, expected) => {
    const result = datasetPermissionsTemplate(name, rowsShape, ownerColumn ? { ownerColumn } : {});
    expect(result).toEqual({ ok: true, policy: expected });
    expect(validateDatasetPermissions(expected, rowsShape)).toEqual({ ok: true, policy: expected });
  });
  it('own-rows names a missing or absent owner column; unknown templates are refused', () => {
    expect(datasetPermissionsTemplate('own-rows', rowsShape, { ownerColumn: 'author' })).toEqual({
      ok: false,
      errors: [{ path: 'ownerColumn', message: 'unknown column "author" in public.rows; columns are name, shift, created_by' }],
    });
    expect(datasetPermissionsTemplate('own-rows', rowsShape, {})).toEqual({
      ok: false,
      errors: [{ path: 'ownerColumn', message: 'own-rows needs an owner column' }],
    });
    expect(datasetPermissionsTemplate('public', rowsShape, {})).toEqual({
      ok: false,
      errors: [{ path: 'template', message: 'unknown template "public"; templates are read-only, own-rows, editors-only' }],
    });
  });
});

describe('plain-language read-back', () => {
  const template = (name: string, ownerColumn?: string) => {
    const r = datasetPermissionsTemplate(name, rowsShape, ownerColumn ? { ownerColumn } : {});
    // Collected eagerly by it.each; a failure here surfaces as a read-back mismatch.
    return r.ok ? r.policy : ({ version: 3, tables: [] } as DatasetPermissions);
  };
  const cases: [string, DatasetPermissions, Parameters<typeof readBackDatasetPermissions>[1], string][] = [
    [
      'the plan’s signups policy',
      wrap(fixture('plan-signups').table) as DatasetPermissions,
      undefined,
      [
        'Table signups (public.rows)',
        '- Owner, editors: see and change everything.',
        '- Shared viewers: see all rows and columns; cannot change anything.',
        '- Signed-in link holders: see all rows and columns; add rows (filling name and shift; Created By is set to them); change shift only on rows they created; delete rows they created.',
        '- Signed-out link holders: see name and shift, at most 200 rows; cannot change anything.',
        'Warnings: none.',
      ].join('\n'),
    ],
    [
      'read-only',
      template('read-only'),
      undefined,
      [
        'Table public.rows',
        '- Owner, editors: see and change everything.',
        '- Shared viewers, signed-in link holders, signed-out link holders: see all rows and columns; cannot change anything.',
        'Warnings: none.',
      ].join('\n'),
    ],
    [
      'own-rows',
      template('own-rows', 'created_by'),
      undefined,
      [
        'Table public.rows',
        '- Owner, editors: see and change everything.',
        '- Shared viewers, signed-in link holders: see all rows and columns; add rows (filling name and shift; created_by is set to them); change name and shift only on rows they created; delete rows they created.',
        '- Signed-out link holders: see all rows and columns; cannot change anything.',
        'Warnings: none.',
      ].join('\n'),
    ],
    [
      'editors-only',
      template('editors-only'),
      undefined,
      [
        'Table public.rows',
        '- Owner, editors: see and change everything.',
        '- Shared viewers, signed-in link holders, signed-out link holders: no access.',
        'Warnings: none.',
      ].join('\n'),
    ],
    [
      'conditions, presets, owner apps and every warning',
      {
        version: 3,
        tables: [
          {
            table: rows,
            select_permissions: [
              { role: 'signed_in', permission: { columns: ['name'], filter: { _or: [{ shift: { _gt: 2 } }, { name: { _is_null: true } }] } } },
            ],
            insert_permissions: [
              { role: 'anonymous', permission: { check: { shift: { _in: [1, 2] } }, set: { created_by: 'X-Hasura-Page-Id', name: 'guest' } } },
            ],
            update_permissions: [
              { role: 'signed_in', permission: { columns: '*', filter: { created_by: { _eq: 'X-Hasura-User-Id' } }, backend_only: true } },
            ],
            delete_permissions: [
              { role: 'viewer', permission: { filter: { _not: { name: { _ilike: 'keep%' } } } } },
            ],
          },
        ],
      },
      { visibility: 'private' },
      [
        'Table public.rows',
        '- Owner, editors: see and change everything.',
        '- Shared viewers: cannot see rows; delete rows where not (name matches "keep%" in any case).',
        "- Signed-in link holders: see name of rows where (shift is above 2 or name is empty); change anything only on rows where created_by is them, only through the owner's apps.",
        '- Signed-out link holders: cannot see rows; add rows (created_by is set to this page; name is set to "guest") only when shift is one of 1 or 2.',
        'Warnings:',
        '- anonymous can write (throttled to 30 per minute)',
        '- rule uses X-Hasura-Page-Id: direct API calls are denied',
        '- update without check lets rows move out of the filter',
        '- dataset is private: signed_in and anonymous rules never apply',
      ].join('\n'),
    ],
  ];
  it.each(cases)('%s', (_name, policy, options, text) => {
    const readBack = readBackDatasetPermissions(policy, options);
    expect(readBack.text).toBe(text);
    expect(readBack.tables.map((t) => t.title)).toEqual([text.split('\n')[0]]);
  });
  it('returns warning codes for callers that act on them', () => {
    const policy = { version: 3, tables: [{ table: rows, insert_permissions: [{ role: 'anonymous', permission: { check: {} } }] }] } as DatasetPermissions;
    expect(readBackDatasetPermissions(policy).warnings).toEqual([
      { code: 'anonymous_write', message: 'anonymous can write (throttled to 30 per minute)' },
    ]);
  });
});
