import { expect, it } from 'vitest';
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
