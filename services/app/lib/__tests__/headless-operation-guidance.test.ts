import {describe,expect,it} from 'vitest';
import {buildQuickSheet} from '../skills';
import teaching from '../../../cli/src/generated/teaching.json';

describe('headless operation guidance',()=>{
 it('puts named reads and named writes on the always-read first page',()=>{
  const sheet=buildQuickSheet('https://artifactbin.dev');
  expect(sheet).toMatch(/afbin query[^\n]*--name/);
  expect(sheet).toMatch(/afbin query[^\n]*--write[^\n]*--name/);
 });
 it('distinguishes routine operations from authoring QA in the first-page instructions',()=>{
  const instructions=buildQuickSheet('https://artifactbin.dev').split('```jsx')[0];
  expect(instructions).toMatch(/(?:prefer|default)[^\n]*afbin query|afbin query[^\n]*(?:prefer|default)/i);
  expect(instructions).toMatch(/existing artifact/i);
  expect(instructions).toMatch(/sessions[^\n]*(?:browser|UI)/i);
  expect(instructions).toMatch(/(?:page.local|local state)/i);
  expect(instructions).toMatch(/(?:row|cell).{0,30}(?:context|action)/i);
  expect(instructions).toMatch(/(?:newly authored|new actions|new mutations)/i);
 });
 it('does not incorrectly restrict generated query help to dataset writes',()=>{
  const guide=teaching.files['references/publishing-query.md'];
  expect(guide).not.toContain('Writes require --write and a dataset target.');
  expect(guide).toMatch(/--write\s+--name/);
 });
});

describe('notification authoring contract',()=>{
 it('teaches native source queries and one combined result per joined recipient',()=>{
  const guide=teaching.files['references/markup-notifications.md'];
  expect(guide).toBeDefined();
  expect(guide).toContain('source="ref:');
  expect(guide).toContain('existing dataset query interface');
  expect(guide).toContain('Postgres');
  expect(guide).toContain('one notification per user per mutation run');
  expect(guide).toContain('across all linked rules');
  expect(guide).toContain('distinct messages');
  expect(guide).toContain('explicitly joined');
  expect(guide).toContain('all rules succeed');
  expect(guide).not.toContain('one job per rule');
 });
 it('teaches failure isolation and preserves current-state reads rather than snapshots',()=>{
  const guide=teaching.files['references/markup-notifications.md']??'';
  expect(guide).toContain('saved scalar arguments');
  expect(guide).toContain('may see later changes');
  expect(guide).toContain('zero rows');
  expect(guide).toContain('never rerun the successful mutation');
  expect(guide).toContain('every dataset used by the query');
 });
});
