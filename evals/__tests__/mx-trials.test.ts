import { expect, it } from 'vitest';
import { runDataflow } from '../../services/app/lib/sql/run-dataflow';
import { validateMarkupStructure } from '../../services/app/lib/story/local-validation';
import { fixtureMarkup, sessionVerdict } from '../lib/mx-trials/tasks.mjs';
it('rejects self-reported success when the observed state or write count is wrong', () => {
  const page = {url:'/a/abcdef',signals:{region:{value:'North'},taskTitle:{value:'untouched'},tasks:{value:{rows:[{title:'Existing'}]}}}};
  const evidence = {pages:[page],executions:[{session_id:'one',result:'NOT_WRITABLE'}],sourceChanged:false};
  expect(sessionVerdict('invalid',evidence).passed).toBe(true);
  expect(sessionVerdict('invalid',{...evidence,pages:[{...page,signals:{...page.signals,region:{value:'South'}}}]}).passed).toBe(false);
  expect(sessionVerdict('invalid',{...evidence,sourceChanged:true}).noUnintendedWrites).toBe(false);
  expect(sessionVerdict('mutate',{...evidence,executions:[{result:'committed'}]}).passed).toBe(false);
});

it('uses a publishable real-runtime fixture', () => {
  expect(validateMarkupStructure(fixtureMarkup('')).errors).toEqual([]);
});

it('the fixture produces ready rows and an intentional query error', async () => {
  const {content} = validateMarkupStructure(fixtureMarkup('')).split!;
  const flow = {values:content.values,queries:content.queries,mutations:content.mutations};
  const ready = await runDataflow(flow, {});
  expect(ready.errors).toEqual({});
  expect(ready.tables.sales.rows).toEqual([{name:'North total',revenue:110}]);
  const broken = await runDataflow(flow, {}, {values:{region:'Broken'}});
  expect(broken.errors.sales).toMatch(/convert|cast|invalid/i);
});

it('identifies duplicate artifacts independently of signal query parameters', () => {
  const page = {signals:{region:{value:'North'},taskTitle:{value:'untouched'},tasks:{value:{rows:[{title:'Existing'}]}}}};
  const evidence={pages:[{...page,url:'http://app/@owner/abcdef',id:'one'},{...page,url:'http://app/@owner/abcdef?$region=South',id:'two',signals:{...page.signals,region:{value:'South'}}}],executions:[{session_id:'session'},{session_id:'session'}],sourceChanged:false};
  expect(sessionVerdict('duplicate',evidence).passed).toBe(true);
  expect(sessionVerdict('duplicate',{...evidence,pages:[evidence.pages[0],{...evidence.pages[1],url:'http://app/@owner/ghijkl'}]}).passed).toBe(false);
});

it('can build session fixtures without inert iframe controls', () => {
  expect(fixtureMarkup('',false)).not.toContain('<Iframe');
  expect(fixtureMarkup('',false)).toContain('Host region');
});

it('accepts recorded signal values without requiring one serialization shape', () => {
  const page={url:'/a/abcdef',signals:{region:{value:'South'},taskTitle:{value:'untouched'},tasks:{value:{rows:[{title:'Existing'}]}}},observed:[{value:'North',status:'ready'},{value:'South',status:'ready'}]};
  const evidence={pages:[page],executions:[],sourceChanged:false,subscriptionStopped:true};
  expect(sessionVerdict('subscribe',evidence).passed).toBe(true);
  expect(sessionVerdict('subscribe',{...evidence,subscriptionStopped:false}).passed).toBe(false);
});
