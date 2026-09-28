import { describe, expect, it } from 'vitest';
import { parseJsx, serializeJsx } from '@/lib/jsx';
import { dataflowOf, splitHelmet, validateHelmet } from '@/lib/story/helmet';
import { validateMarkupStructure } from '@/lib/story/local-validation';
import { readerDataflow } from '@/lib/story/compiled-dataflow';
import { COMPILED_DATAFLOW, finalizeArtifactMetadata, storedCompiledDataflow, parseCompiledDataflow } from '@/lib/story/parsed-artifact-metadata';
import { storyUpdateParts } from '@/lib/story/update-parts';
import { compileDataflow, prepareCompile, type ImportSource } from '@/lib/story/compile-dataflow';

const parse = (source: string) => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.nodes;
};
const source = (message = 'Task status is current', on = 'change_status', parameter = 'task_id') =>
  '<Helmet><Import name="tasks" src="ref:TaskRows1" />'
  + '<Mutation name="change_status">{`update tasks.rows set status = $status where id = $task_id`}</Mutation>'
  + '<Notify name="status_notification" on="' + on + '">{`'
  + 'select assignee as "to", \'' + message + '\' as message from tasks.rows where id = $' + parameter
  + '`}</Notify></Helmet><p>Tasks</p>';
const dataset: ImportSource = {kind:'dataset',tables:[{name:'rows',columns:[
  {name:'id',type:'string'}, {name:'status',type:'string'}, {name:'assignee',type:'user'},
]}]};
const compile = async (markup: string) => {
  const {content, body} = splitHelmet(parse(markup));
  const flow = dataflowOf(content);
  const ctx = {...await prepareCompile(flow, async ref => ref === 'Folder001' ? {...dataset, kind:'folder'} : ['TaskRows1', 'TaskRows2'].includes(ref) ? dataset : ref === 'PgConn001' ? {kind:'postgres', tables:[], probe:async () => ({columns:[{name:'assignee',type:'user'}],params:[]})} : null), now:'2026-09-28T10:00:00.000Z'};
  return compileDataflow(flow, ctx, body);
};

describe('standalone mutation notification queries', () => {
  it('accepts Notify beside a Mutation, with SQL as its child', () => {
    expect(validateHelmet(parse(source()))).toEqual([]);
  });
  it('retains linkage and escaped query text through serialization', () => {
    const flow = dataflowOf(splitHelmet(parse(serializeJsx(parse(source('Task <status> & saved'))))).content);
    expect(flow).toMatchObject({notifications:[{
      name:'status_notification', on:'change_status',
      sql:'select assignee as "to", \'Task <status> & saved\' as message from tasks.rows where id = $task_id',
    }]});
    expect(flow.mutations[0]?.expectedAffected).toBeUndefined();
  });
  it('invalidates notification SQL edits but not body prose', () => {
    const original = storyUpdateParts(source())!;
    const changed = storyUpdateParts(source('Task state changed'))!;
    expect(original.declarations).not.toBe(changed.declarations);
    expect(original.declarations).toBe(storyUpdateParts(source().replace('<p>Tasks</p>','<p>Other prose</p>'))!.declarations);
  });
  it('compiles a linked mutation argument without requiring a page Value', async () => {
    const result = await compile(source());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.compiled).toMatchObject({notifications:[{
      name:'status_notification',on:'change_status',params:['task_id'],
    }]});
  });
  it('rejects a notification argument absent from the linked mutation', async () => {
    const result = await compile(source(undefined,undefined,'another_id'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some(e => e.tag === 'Notify' && e.message.includes('another_id'))).toBe(true);
  });
  it('rejects a missing mutation reference', async () => {
    const result = await compile(source(undefined,'missing_mutation'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some(e => e.tag === 'Notify' && e.message.includes('missing_mutation'))).toBe(true);
  });
});


const withSql = (sql: string, extra = '') => source().replace(/select assignee.*?`}/, sql + '`}').replace('</Helmet>', extra + '</Helmet>');
const refusal = async (markup: string, pattern: RegExp) => {
  const result = await compile(markup);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.some((e) => e.tag === 'Notify' && pattern.test(e.message))).toBe(true);
};

describe('notification authoring boundaries', () => {
  it.each([
    ['missing name', '<Notify on="change_status">{`select null as "to", \'x\' as message`}</Notify>'],
    ['missing on', '<Notify name="n">{`select null as "to", \'x\' as message`}</Notify>'],
    ['dynamic on', '<Notify name="n" on={$action}>{`select null as "to", \'x\' as message`}</Notify>'],
    ['extra actor attribute', '<Notify name="n" on="change_status" actor="someone">{`select 1`}</Notify>'],
    ['dynamic SQL', '<Notify name="n" on="change_status">{sql}</Notify>'],
    ['empty SQL', '<Notify name="n" on="change_status">{``}</Notify>'],
  ])('rejects %s', (_label, declaration) => {
    expect(validateMarkupStructure(source().replace(/<Notify[\s\S]*?<\/Notify>/, declaration)).errors.length).toBeGreaterThan(0);
  });

  it('rejects body and nested declarations with placement guidance', () => {
    const n = '<Notify name="n" on="change_status">{`select null as "to", \'x\' as message`}</Notify>';
    expect(validateMarkupStructure('<p>' + n + '</p>').errors.some((e) => /Helmet/.test(e.message))).toBe(true);
    expect(validateMarkupStructure(source().replace('</Mutation>', n + '</Mutation>')).errors.length).toBeGreaterThan(0);
  });

  it('rejects duplicate notification names and collisions with other declarations', async () => {
    const n = source().match(/<Notify[\s\S]*?<\/Notify>/)![0];
    await refusal(source().replace('</Helmet>', n + '</Helmet>'), /twice/);
    await refusal(source().replace('name="status_notification"', 'name="tasks"'), /twice/);
    expect(validateMarkupStructure(source().replace('name="status_notification"', 'name="tasks"')).errors.some((e) => /twice/.test(e.message))).toBe(true);
  });

  it.each([
    ['select assignee as recipient, status as message from tasks.rows', /exactly/],
    ['select assignee as "to", status as message, id from tasks.rows', /exactly/],
    ['update tasks.rows set status = \'changed\'', /read|SELECT/i],
    ['select assignee as "to", status as message from tasks.rows; delete from tasks.rows', /statement|SELECT/i],
  ])('rejects non-contract SQL: %s', async (sql, message) => { await refusal(withSql(sql), message); });

  it('rejects notification-only page state and unsupported snapshot/actor inputs', async () => {
    await refusal(withSql('select assignee as "to", $page_only as message from tasks.rows', '<Value name="page_only" />'), /page_only/);
    for (const param of ['_before.id', '_after.id', '_actor', '_row.id', '_value']) {
      await refusal(withSql('select assignee as "to", $' + param + ' as message from tasks.rows'), /saved|built-in/);
    }
  });

  it('accepts saved platform context without adding mutation arguments', async () => {
    const result = await compile(withSql('select $_me.id as "to", $_now || $_tz as message'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.compiled.notifications?.[0]).toMatchObject({ params: ['_me.id', '_now', '_tz'], parameterTypes: { '_me.id': 'user', _now: 'timestamp', _tz: 'string' }, relations: [] });
      expect(result.compiled.mutations[0]?.args.map((a) => a.name)).toEqual(['status', 'task_id']);
    }
  });

  it('preserves explicit cardinality and supports several rules per mutation', async () => {
    const n = source().match(/<Notify[\s\S]*?<\/Notify>/)![0].replace('status_notification', 'second_rule');
    const result = await compile(source().replace('name="change_status"', 'name="change_status" expectedAffected={1}').replace('</Helmet>', n + '</Helmet>'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.compiled.mutations[0]?.expectedAffected).toBe(1);
      expect(result.compiled.notifications?.length).toBe(2);
      expect(result.compiled.queries).toEqual([]);
    }
  });

  it('rejects a local target and local table inputs', async () => {
    const local = '<Value name="local" type="table" value={[{id:"a", status:"new"}]} />';
    await refusal(source().replace('update tasks.rows', 'update local').replace('</Helmet>', local + '</Helmet>'), /persistent/);
    await refusal(withSql('select null as "to", status as message from local', local), /local table/);
  });

  it('includes predicate-only reads and transitive named-query lineage', async () => {
    const extra = '<Value name="task_id" />'
      + '<Query name="filtered">{`select assignee from tasks.rows where id = $task_id`}</Query>';
    const result = await compile(withSql('select assignee as "to", \'current\' as message from filtered where exists (select 1 from tasks.rows where status = $status)', extra));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.compiled.notifications?.[0]).toMatchObject({ params: ['status', 'task_id'], reads: { queries: ['filtered'], imports: ['tasks'] }, relations: [{ schema: 'tasks', table: 'rows' }] });
  });

  it('rejects transitive page-only parameters and membership tables', async () => {
    await refusal(withSql('select assignee as "to", \'current\' as message from filtered', '<Value name="page_only" /><Query name="filtered">{`select assignee from tasks.rows where id = $page_only`}</Query>'), /page_only/);
    await refusal(withSql('select user_id as "to", \'current\' as message from _members'), /_members/);
    const result = await compile(withSql('select id as "to", \'current\' as message from _me'));
    expect(result.ok).toBe(true);
  });

  it('stores a strict versioned plan, invalidates old metadata and projects it out of reader flow', async () => {
    const markup = source();
    const result = await compile(markup);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const meta = finalizeArtifactMetadata('markup', markup, { [COMPILED_DATAFLOW]: result.compiled });
    expect(storedCompiledDataflow(JSON.parse(JSON.stringify(meta)), markup)).toEqual(result.compiled);
    expect(parseCompiledDataflow(result.compiled)).toEqual(result.compiled);
    const record = meta.parsedArtifact as Record<string, unknown>;
    expect(storedCompiledDataflow({parsedArtifact:{...record,compilerRevision:'sqlite-compiled-1'}},markup)).toBeNull();
    expect(parseCompiledDataflow({...result.compiled,notifications:[{...result.compiled.notifications![0], secret:'credentials'}]})).toBeNull();
    expect(parseCompiledDataflow({...result.compiled,notifications:[{...result.compiled.notifications![0], params:[1]}]})).toBeNull();
    expect(readerDataflow(result.compiled)).not.toHaveProperty('notifications');
    expect(readerDataflow(result.compiled)?.mutations[0]?.notifies).toBe(true);
    expect(result.compiled.notifications).toHaveLength(1);
    expect(readerDataflow(null)).toBeNull();
  });
});


describe('notification source provenance', () => {
  it('retains a second source used only in a filter', async () => {
    const result = await compile(withSql('select t.assignee as "to", t.status as message from tasks.rows t where exists (select 1 from reviewers.rows r where r.id=t.id)', '<Import name="reviewers" src="ref:TaskRows2" />'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.compiled.notifications?.[0]?.relations).toEqual([{schema:'tasks',table:'rows'},{schema:'reviewers',table:'rows'}]);
  });

  it('refuses unsupported folder source authority', async () => {
    await refusal(withSql('select assignee as "to", status as message from folder.rows', '<Import name="folder" src="ref:Folder001" />'), /folder|stored dataset/);
  });

  it('refuses connected Postgres query dependency without transitive lineage', async () => {
    await refusal(withSql('select assignee as "to", \'current\' as message from remote', '<Query name="remote" source="ref:PgConn001">{`select assignee from remote_table`}</Query>'), /unsupported source lineage/);
  });

  it('rebinds notification spans to normalized source without losing linkage', async () => {
    const markup=source();
    const result=await compile(markup);
    if(!result.ok)throw new Error(JSON.stringify(result.errors));
    const moved='\n\n'+markup;
    const meta=finalizeArtifactMetadata('markup',moved,{[COMPILED_DATAFLOW]:result.compiled});
    const restored=storedCompiledDataflow(meta,moved)!;
    expect(restored.notifications?.[0]?.start).toBe(result.compiled.notifications![0]!.start+2);
    expect(restored.notifications?.[0]?.on).toBe('change_status');
  });
});
