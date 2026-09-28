import { describe, expect, it } from 'vitest';
import { parseJsx, serializeJsx } from '@/lib/jsx';
import { dataflowOf, splitHelmet, validateHelmet } from '@/lib/story/helmet';
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
  const ctx = {...await prepareCompile(flow, async ref => ref === 'TaskRows1' ? dataset : null), now:'2026-09-28T10:00:00.000Z'};
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

it.each(['dataset', 'postgres'] as const)('compiles Notify through the ordinary %s source query path', async (kind) => {
  const markup = source().replace('<Notify name="status_notification"', '<Notify source="ref:Remote001" name="status_notification"');
  const flow = dataflowOf(splitHelmet(parse(markup)).content);
  const ctx = await prepareCompile(flow, async ref => ref === 'TaskRows1' ? dataset : {
    kind, tables: [], probe: async (_sql, params) => { if (!Object.hasOwn(params,'task_id')) throw new Error('missing task_id'); return {columns:[{name:'to',type:'user'}, {name:'message',type:'string'}],params:['task_id']}; },
  });
  const result = compileDataflow(flow,ctx);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.compiled.notifications?.[0]?.source).toBe('Remote001');
});
