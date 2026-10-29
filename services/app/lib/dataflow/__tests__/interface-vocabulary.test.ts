/**
 * lib/dataflow's vocabulary through its doors: the declaration tags and grammar, the built-ins, scalar typing, the
 * compiled record's questions, reader local tables, mutation requests, query values, reference media and column
 * kinds. Pure: no engine, no database.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx, type JsxElement } from '@/lib/jsx';
import { compiledSource } from '@/test/helpers/compiled';
import {
  bindMutationRequest, EMPTY_COMPILED_DATAFLOW, HOLD_MAX_BYTES, HOLD_MAX_ROWS, imageReferenceId, imageRefData, importRef,
  initialValues, LocalStateInputError, localTableOverrides, mutationRequestFor, mutationTargetRef, NUMERIC_AGGS,
  parseLocalTables, parseMutationRequest, platformValues, rawUrl, readerDataflow, readerZone, rowField, scalarMatches,
  validateQueryValues, VIEWER, VIEWER_ID, type CompiledDataflow,
} from '..';
import {
  ARGS_ATTR, controlOptions, DECL_NAME_RE, IMPORT_TAG, NOTIFY_TAG, parseDeclaration, parseNotifyDecl, QUERY_TAG, SET_ATTR,
} from '../dataflow';
import {
  BUILTIN_TABLES, builtinInput, CLOCK_FUNCTIONS, isBuiltinInput, isBuiltinTable, localZone, READ_ONLY_REF_ATTRS,
  reservedDeclarationName,
} from '../builtins';
import { checkedLocalRows } from '../local-tables';
import { boundImageValue } from '../image-source';
import { columnVizKind, inferColumns } from '../dataset-shape';

const el = (source: string): JsxElement => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.nodes[0] as JsxElement;
};
const PLATFORM = { userId: 'u1', now: '2026-09-30T10:00:00.000Z', tz: 'UTC' };

describe('declaration grammar', () => {
  it('names the tags and attributes', () => {
    expect([IMPORT_TAG, QUERY_TAG, NOTIFY_TAG, SET_ATTR, ARGS_ATTR]).toEqual(['Import', 'Query', 'Notify', 'set', 'args']);
  });

  it('a declared name is an identifier', () => {
    for (const name of ['a', '_x', 'A1', 'snake_case']) expect(DECL_NAME_RE.test(name), name).toBe(true);
    for (const name of ['', '1a', 'a-b', 'a.b', 'é', 'a b']) expect(DECL_NAME_RE.test(name), name).toBe(false);
  });

  it('parseDeclaration dispatches by tag, and declares nothing for other tags or plain elements', () => {
    expect(parseDeclaration(el('<Query name="q">{`select 1 as a`}</Query>'))).toMatchObject({ kind: 'query', decl: { name: 'q' } });
    expect(parseDeclaration(el('<Value name="n" type="number" default={2} />'))).toMatchObject({ kind: 'value', decl: { name: 'n' } });
    expect(parseDeclaration(el('<Import name="b" src="ref:BookRows1" />'))).toMatchObject({ kind: 'import', decl: { name: 'b' } });
    expect(parseDeclaration(el('<Card />'))).toBeNull();
    expect(parseDeclaration(el('<query name="q" />'))).toBeNull();
    expect(parseDeclaration(el('<Query>{`select 1`}</Query>'))).toHaveProperty('errors');
  });

  it('parseNotifyDecl reads name, on and its one static SQL child', () => {
    const ok = parseNotifyDecl(el('<Notify name="ping" on="save">{`select 1 as to, \'hi\' as message`}</Notify>'));
    expect(ok).toMatchObject({ ok: true, decl: { name: 'ping', on: 'save', sql: "select 1 as to, 'hi' as message" } });
    expect(ok.ok && ok.decl).not.toHaveProperty('source');
  });

  it.each([
    ['an unknown attribute', '<Notify name="p" on="save" to="x">{`select 1`}</Notify>', /takes only name=, on= and source=/],
    ['no on=', '<Notify name="p">{`select 1`}</Notify>', /on= must name a declared persistent Mutation/],
    ['a reserved on=', '<Notify name="p" on="_me">{`select 1`}</Notify>', /on= must name/],
    ['an empty SQL child', '<Notify name="p" on="save">{`  `}</Notify>', /one non-empty static SQL/],
    ['no child', '<Notify name="p" on="save" />', /one non-empty static SQL/],
  ])('parseNotifyDecl refuses %s', (_label, source, message) => {
    const result = parseNotifyDecl(el(source));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((e) => e.message).join('\n')).toMatch(message);
  });

  it('controlOptions reads literal options and a query table', () => {
    expect(controlOptions(['a', 2, { value: 'v', label: 'L' }, { value: 'only' }, null])).toEqual([
      { value: 'a', label: 'a' }, { value: '2', label: '2' }, { value: 'v', label: 'L' }, { value: 'only', label: 'only' }, { value: 'null', label: 'null' },
    ]);
    const table = { columns: [{ name: 'id', type: 'number' as const }, { name: 'name', type: 'string' as const }], rows: [{ id: 1, name: 'One' }, { id: 2, name: null }] };
    expect(controlOptions('$opts', table)).toEqual([{ value: '1', label: 'One' }, { value: '2', label: '2' }]);
    expect(controlOptions('$opts', { columns: [table.columns[0]!], rows: [{ id: 3 }] })).toEqual([{ value: '3', label: '3' }]);
    expect(controlOptions('$opts')).toEqual([]);
    expect(controlOptions('not a ref')).toEqual([]);
    expect(controlOptions(undefined)).toEqual([]);
  });
});

describe('built-ins', () => {
  it('names the viewer and the built-in tables', () => {
    expect([VIEWER, VIEWER_ID]).toEqual(['_me', '_me.id']);
    expect(Object.keys(BUILTIN_TABLES)).toEqual(['_me', '_members']);
    expect(BUILTIN_TABLES._me.columns).toEqual([{ name: 'id', type: 'user' }]);
    expect(isBuiltinTable('_me')).toBe(true);
    expect(isBuiltinTable('_members')).toBe(true);
    expect(isBuiltinTable('members')).toBe(false);
    expect(isBuiltinTable('toString')).toBe(false);
    expect(isBuiltinTable('__proto__')).toBe(false);
  });

  it('builtinInput resolves a row field to the _row spec', () => {
    expect(builtinInput('_row.day')?.name).toBe('_row');
    expect(builtinInput('_me.id')?.name).toBe('_me.id');
    expect(builtinInput('_now')?.name).toBe('_now');
    expect(builtinInput('_row.')).toBeNull();
    expect(builtinInput('nope')).toBeNull();
    expect(isBuiltinInput('_tz')).toBe(true);
    expect(isBuiltinInput('_unknown')).toBe(false);
  });

  it('rowField reads the field of _row only', () => {
    expect(rowField('_row.day')).toBe('day');
    expect(rowField('_row.a_b1')).toBe('a_b1');
    expect(rowField('_row')).toBeNull();
    expect(rowField('row.day')).toBeNull();
    expect(rowField('_me.id')).toBeNull();
  });

  it('refuses SQLite clock functions, and keeps the read-only built-in positions tiny', () => {
    expect([...CLOCK_FUNCTIONS].sort()).toEqual(['current_date', 'current_time', 'current_timestamp']);
    expect(Object.keys(READ_ONLY_REF_ATTRS).sort()).toEqual(['User', 'UserHandle', 'UserImage']);
    expect([...READ_ONLY_REF_ATTRS.User!]).toEqual(['userId']);
  });

  it('reservedDeclarationName names why, or null for a free name', () => {
    expect(reservedDeclarationName('_x')).toMatch(/belong to the built-ins/);
    expect(reservedDeclarationName('ref_abc')).toMatch(/<Import>/);
    expect(reservedDeclarationName('a__b')).toMatch(/double underscore/);
    expect(reservedDeclarationName('plain')).toBeNull();
    expect(reservedDeclarationName('ref')).toBeNull();
  });

  it('platformValues and reader zones', () => {
    expect(platformValues(PLATFORM)).toEqual({ '_me.id': 'u1', _now: PLATFORM.now, _tz: 'UTC' });
    expect(platformValues({ userId: null, now: 'n', tz: 't' })['_me.id']).toBeNull();
    expect(readerZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    for (const tz of ['Not/AZone', '', 7, null, 'x'.repeat(65)]) expect(readerZone(tz), String(tz)).toBe('UTC');
    expect(readerZone(localZone())).toBe(localZone());
  });
});

describe('scalar typing', () => {
  it.each([
    [1.5, 'number', true], [Number.NaN, 'number', false], [Infinity, 'number', false], ['1', 'number', false],
    [true, 'boolean', true], [0, 'boolean', false],
    ['2026-01-31', 'date', true], ['2026-1-31', 'date', false], [20260131, 'date', false],
    ['x', 'string', true], ['', 'string', true], ['u', 'user', true], [1, 'user', false],
    [null, 'number', true], [null, 'date', true],
  ] as const)('scalarMatches(%j, %s) is %s', (value, type, expected) => {
    expect(scalarMatches(value, type)).toBe(expected);
  });
});

describe('the compiled record', () => {
  const source = '<Helmet><Import name="books" src="ref:BookRows1" /><Value name="n" type="number" default={3} /><Value name="s" default="x" />'
    + '<Value name="t" type="table" value={[{"a":1}]} />'
    + '<Mutation name="add">{`insert into books.rows (id) values ($n)`}</Mutation>'
    + '<Mutation name="local">{`insert into t (a) values (1)`}</Mutation></Helmet><p>{$n}</p>';
  const columns = [{ name: 'id', type: 'number' as const }];
  let flow: CompiledDataflow;
  const compiled = async () => (flow ??= await compiledSource(source, { BookRows1: columns }));

  it('initialValues holds every scalar at its default', async () => {
    expect(initialValues(await compiled())).toEqual({ n: 3, s: 'x' });
    expect(initialValues(EMPTY_COMPILED_DATAFLOW)).toEqual({});
  });

  it('importRef and mutationTargetRef name the dataset an import reads and a mutation writes', async () => {
    const f = await compiled();
    expect(importRef(f, 'books')).toBe('BookRows1');
    expect(importRef(f, 'nope')).toBeUndefined();
    expect(mutationTargetRef(f, f.mutations.find((m) => m.name === 'add')!)).toBe('BookRows1');
    expect(mutationTargetRef(f, f.mutations.find((m) => m.name === 'local')!)).toBeNull();
  });

  it('readerDataflow drops notification SQL, and leaves a record without any as is', async () => {
    const f = await compiled();
    expect(readerDataflow({ ...f, notifications: [{ name: 'x' }] as never })).toEqual(f);
    expect(readerDataflow(f)).toEqual(f);
    expect(EMPTY_COMPILED_DATAFLOW).toEqual({ imports: [], values: [], queries: [], mutations: [] });
  });

  it('localTableOverrides replaces only declared inline tables, row by row checked', async () => {
    const f = await compiled();
    expect(localTableOverrides(f, { t: [{ a: 2 }, {}] })).toEqual({ t: { columns: f.values.find((v) => v.name === 't')!.kind === 'table' ? expect.any(Array) : [], rows: [{ a: 2 }, { a: null }] } });
    expect(localTableOverrides(f)).toEqual({});
    expect(() => localTableOverrides(f, { books: [] })).toThrow(LocalStateInputError);
    expect(() => localTableOverrides(f, { n: [] })).toThrow('"n" is not a declared inline table');
  });

  it('bindMutationRequest binds declared arguments and refuses what the signature does not take', async () => {
    const f = await compiled();
    const add = f.mutations.find((m) => m.name === 'add')!;
    const ok = bindMutationRequest(f, add, { mutation: 'add', args: {} }, PLATFORM);
    expect(ok.ok).toBe(true);
    expect(bindMutationRequest(f, add, { mutation: 'add', args: { zzz: 1 } }, PLATFORM)).toMatchObject({ ok: false, reason: 'invalid_sql' });
    expect(bindMutationRequest(f, add, { mutation: 'add', args: {}, row: { id: 1 } }, PLATFORM)).toMatchObject({ ok: false, reason: 'invalid_row', detail: 'this mutation does not read a row' });
    expect(bindMutationRequest(f, add, { mutation: 'add', args: {}, value: 1 }, PLATFORM)).toMatchObject({ ok: false, detail: 'this mutation does not accept a value' });
  });

  it('mutationRequestFor builds the request a page sends, which the door then parses back', async () => {
    const f = await compiled();
    const add = f.mutations.find((m) => m.name === 'add')!;
    const request = mutationRequestFor(add, { values: { n: 7 }, tz: 'Asia/Kolkata' });
    expect(request).toMatchObject({ mutation: 'add', tz: 'Asia/Kolkata' });
    expect(request).not.toHaveProperty('row');
    expect(request).not.toHaveProperty('value');
    expect(parseMutationRequest(JSON.parse(JSON.stringify(request)))).toEqual(request);
  });
});

describe('parseMutationRequest', () => {
  it('reads the bounded wire shape', () => {
    expect(parseMutationRequest({ mutation: 'save', args: { a: 1, b: null }, row: { id: 'x' }, value: true, tz: 'UTC' }))
      .toEqual({ mutation: 'save', args: { a: 1, b: null }, row: { id: 'x' }, value: true, tz: 'UTC' });
    expect(parseMutationRequest({ mutation: 'save' })).toEqual({ mutation: 'save', args: {} });
    expect(parseMutationRequest({ mutation: 'save', operationKey: 'k'.repeat(16) })).toMatchObject({ operationKey: 'k'.repeat(16) });
  });

  it.each([
    [{ mutation: 'save', sql: 'drop table x' }, 'unknown_mutation_fields'],
    [{ mutation: '1bad' }, 'invalid_mutation'],
    [{}, 'invalid_mutation'],
    [{ mutation: 'save', operationKey: 'short' }, 'invalid_idempotency_key'],
    [{ mutation: 'save', value: { nested: 1 } }, 'invalid_value'],
    [{ mutation: 'save', tz: 3 }, 'invalid_tz'],
    [{ mutation: 'save', localTables: [] }, 'invalid_local_state'],
  ])('refuses %j with a 400', async (body, code) => {
    const response = parseMutationRequest(body as Record<string, unknown>);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(400);
    expect(JSON.stringify(await (response as Response).json())).toContain(code);
  });
});

describe('reader local tables', () => {
  const columns = [{ name: 'a', type: 'number' as const }, { name: 'b', type: 'string' as const }];

  it('parseLocalTables bounds the wire shape', () => {
    expect(parseLocalTables({ t: [{ a: 1 }] })).toEqual({ t: [{ a: 1 }] });
    expect(parseLocalTables({})).toEqual({});
    for (const bad of [null, [], 'x', { t: 'rows' }, { t: Array(10_001).fill({}) }, Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`t${i}`, []]))]) {
      expect(() => parseLocalTables(bad), JSON.stringify(bad).slice(0, 40)).toThrow(LocalStateInputError);
    }
  });

  it('checkedLocalRows types each row by the declared columns and refuses extra fields', () => {
    expect(checkedLocalRows([{ a: 1 }, { b: 'é' }], columns)).toEqual([{ a: 1, b: null }, { a: null, b: 'é' }]);
    expect(checkedLocalRows([], columns)).toEqual([]);
    expect(() => checkedLocalRows([{ c: 1 }], columns)).toThrow('undeclared fields');
    expect(() => checkedLocalRows([{ a: 'one' }], columns)).toThrow('Local field "a" has an invalid type');
    expect(() => checkedLocalRows([[1]], columns)).toThrow(LocalStateInputError);
    expect(() => checkedLocalRows('rows', columns)).toThrow(LocalStateInputError);
  });
});

describe('validateQueryValues', () => {
  const flow = { values: [
    { kind: 'scalar', name: 'n', type: 'number', default: 0 }, { kind: 'scalar', name: 'd', type: 'date', default: null },
    { kind: 'scalar', name: 'at', type: 'timestamp', default: null }, { kind: 'scalar', name: 'who', type: 'user', default: null },
  ] } as unknown as CompiledDataflow;

  it('accepts declared names of the declared type, and null for any', () => {
    expect(validateQueryValues(flow, { n: 2, d: '2026-01-01', at: '2026-01-01T00:00:00.000Z', who: 'u' })).toBeNull();
    expect(validateQueryValues(flow, { n: null, d: null })).toBeNull();
    expect(validateQueryValues(flow, {})).toBeNull();
  });

  it('names unknown names first, then mistyped ones', () => {
    expect(validateQueryValues(flow, { zz: 1, n: 'x' })).toEqual({ code: 'unknown_parameter', names: ['zz'] });
    expect(validateQueryValues(flow, { n: '1', d: 'not a date', who: 3 })).toEqual({ code: 'invalid_parameter', names: ['n', 'd', 'who'] });
  });
});

describe('placement and aggregates', () => {
  it('pins the reader hold caps and the numeric aggregates', () => {
    expect(HOLD_MAX_ROWS).toBe(50_000);
    expect(HOLD_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect([...NUMERIC_AGGS].sort()).toEqual(['avg', 'max', 'median', 'min', 'sum']);
    expect(NUMERIC_AGGS.has('count' as never)).toBe(false);
  });
});

describe('reference media', () => {
  it('rawUrl is the immutable bytes address, versioned', () => {
    expect(rawUrl('Abc123', 4)).toBe('/a/Abc123/raw?v=4');
  });

  it('imageRefData projects dimensions, a data: placeholder and a small variant (not for a capture)', () => {
    const row = { id: 'Img001', version: 2, meta: { width: 640, height: 480, placeholder: 'data:image/png;base64,AA', smallWidth: 320, smallObjectKey: 'k' } };
    const data = imageRefData(row);
    expect(data).toMatchObject({ kind: 'image', url: '/a/Img001/raw?v=2', width: 640, height: 480, blur: 'data:image/png;base64,AA', smallWidth: 320 });
    expect(data.smallUrl).toContain('Img001');
    expect(imageRefData(row, true)).not.toHaveProperty('smallUrl');
    expect(imageRefData({ ...row, meta: { placeholder: 'https://x/a.png', width: '640' } })).toEqual({ kind: 'image', url: '/a/Img001/raw?v=2' });
    expect(imageRefData({ ...row, meta: null })).toEqual({ kind: 'image', url: '/a/Img001/raw?v=2' });
  });

  it('imageReferenceId reads only an exact reference', () => {
    expect(imageReferenceId('ref:Abc123')).toBe('Abc123');
    for (const value of ['ref:abc', 'ref:Abc123!', ' ref:Abc123', 'Abc123', 'ref:', null, 3, undefined]) expect(imageReferenceId(value), String(value)).toBeNull();
  });

  it('boundImageValue resolves a row field or a value template, null for empty', () => {
    expect(boundImageValue('$_row.pic', {}, { pic: 'ref:Abc123' })).toBe('ref:Abc123');
    expect(boundImageValue('$_row.pic', {}, { pic: '' })).toBeNull();
    expect(boundImageValue('$_row.pic', {})).toBeNull();
    expect(boundImageValue('$img', { img: 'https://x.test/a.png' })).toBe('https://x.test/a.png');
    expect(boundImageValue('$img', { img: 3 })).toBe('3');
    expect(boundImageValue('$img', { img: '' })).toBeNull();
    expect(boundImageValue('$img', {})).toBeNull();
  });
});

describe('dataset shape', () => {
  it('columnVizKind maps column types to encoding kinds', () => {
    expect(columnVizKind('number')).toBe('quantitative');
    expect(columnVizKind('date')).toBe('temporal');
    expect(columnVizKind('timestamp')).toBe('temporal');
    for (const t of ['string', 'boolean', 'user'] as const) expect(columnVizKind(t)).toBe('nominal');
  });

  it('inferColumns types columns from sample rows', () => {
    const cols = inferColumns([{ a: 1, b: 'x', c: true }, { a: 2.5, b: null, c: false }]);
    expect(cols.map((c) => c.name)).toEqual(['a', 'b', 'c']);
    expect(cols.find((c) => c.name === 'a')?.type).toBe('number');
    expect(inferColumns([])).toEqual([]);
  });
});
