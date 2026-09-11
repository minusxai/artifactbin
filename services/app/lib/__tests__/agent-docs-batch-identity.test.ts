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
 it('teaches the native file workflow and keeps advanced batch semantics available',()=>{
  expect(doc('SKILL.md')).toContain('afbin push report.jsx');
  const text=doc('references/api.md');
  expect(text).toContain('source (a complete proposed JSX body)');
  expect(text).toContain('exactly one input form');
  expect(text).toContain('1–64 pairs');
  expect(text).toContain('evolving in-memory source');
  expect(text).toContain('Only the final document is validated');
  expect(text).toContain('one version or nothing');
  expect(text).toContain('zero-based edit_index');
  expect(text).toContain('Unrelated concurrent edits rebase');
 });
 it('distinguishes full replacement from targeted edits and separate metadata writes',()=>{
  const text=doc('references/api.md');
  expect(text).toContain('replaces the whole document');
  expect(text).toContain('PATCH /api/artifacts/{id}');
  expect(text).toContain('expectedState');
 });
 it('describes comments as relations that do not rewrite source',()=>{
  const text=doc('references/publishing-annotations.md');
  expect(text).toContain('sidecar relations');
  expect(text).toContain('does not rewrite source');
  expect(text).toContain('never author, change or reuse');
 });
});
