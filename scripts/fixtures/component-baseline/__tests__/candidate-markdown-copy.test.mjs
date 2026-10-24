import {describe,expect,it} from 'vitest';
import {candidateMarkdownCopyCases} from '../candidate-markdown-copy.mjs';

describe('candidate-only Markdown clipboard checks',()=>{
 it('keeps the new copy affordance outside source-baseline parity claims',()=>{
  expect(candidateMarkdownCopyCases.map(test=>test.id)).toEqual(['markdown-copy-success','markdown-copy-rejected']);
  expect(new Set(candidateMarkdownCopyCases.map(test=>test.id)).size).toBe(candidateMarkdownCopyCases.length);
  expect(candidateMarkdownCopyCases.map(test=>test.expectedStatus)).toEqual(['Copied','Copy unavailable']);
  expect(candidateMarkdownCopyCases.every(test=>['real','rejected'].includes(test.clipboard))).toBe(true);
  expect(candidateMarkdownCopyCases.every(test=>test.baselineCompatibility==='candidate-only enhancement')).toBe(true);
 });
});
