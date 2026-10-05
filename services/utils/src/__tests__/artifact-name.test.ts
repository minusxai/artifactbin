import {describe,it,expect} from 'vitest';
import {artifactFileName,titleSlug} from '../artifact-reference';
describe('artifact identity filenames',()=>{
 it('uses the URL slug and stable ID for portable HTML',()=>{
  const title='Artifact + run: a proposal for agents on remote compute';
  expect(artifactFileName('4B7rjX',title)).toBe('4B7rjX-artifact-run-a-proposal-for-agents-on-remote-compute.jsx.html');
  expect(titleSlug(title)).toBe('artifact-run-a-proposal-for-agents-on-remote-compute');
 });
 it('keeps the ID when the title has no slug and bounds unsafe filenames',()=>{
  expect(artifactFileName('4B7rjX','🦊')).toBe('4B7rjX.jsx.html');
  expect(artifactFileName('4B7rjX','../ A: B / C')).toBe('4B7rjX-a-b-c.jsx.html');
  expect(titleSlug('x'.repeat(100))).toHaveLength(60);
 });
});
