import {describe,it,expect} from 'vitest';
import {renderDoc} from '../skills';
const doc=(name:string)=>renderDoc(`artifactbin/${name}`,'https://example.test');
describe('local editing guidance',()=>{
 it('preserves durable body identity through moves and forbids reuse',()=>{
  const text=doc('SKILL.md');
  expect(text).toMatch(/Every body element.*persistent.*id/);
  expect(text).toContain('lifetime');
  expect(text).toMatch(/Move.*same id/);
  expect(text).toMatch(/never reuse an id/);
 });
 it('teaches the native file workflow: one push for create and update, node-scoped rebasing and recovery',()=>{
  expect(doc('SKILL.md')).toContain('afbin push report.jsx');
  const text=doc('references/publishing.md');
  expect(text).toContain('YAML fence');
  expect(text).toContain('afbin.lock');
  expect(text).toContain('Push preserves edits made while the request was in flight');
  expect(text).toContain('frozen journal recovers the original result');
  expect(text).toContain('conditional replacement');
 });
 it('distinguishes full replacement from metadata and folder settings, all as fields of the pushed file',()=>{
  const text=doc('references/publishing.md');
  expect(text).toContain('Full replacement, metadata and folder settings are fields of the file you push');
  expect(text).not.toContain('afbin api');
  expect(text).not.toContain('PATCH /api/');
 });
 it('describes comments as relations that do not rewrite source',()=>{
  const text=doc('references/publishing-annotations.md');
  expect(text).toContain('sidecar relations');
  expect(text).toContain('does not rewrite source');
  expect(text).toContain('never author, change or reuse');
 });
});
