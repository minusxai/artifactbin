import {htmlTextFingerprint} from '@artifactbin/contracts';
import { afterEach, expect, it } from 'vitest';
import { captureHtmlRange, resolveHtmlRange } from '../range';
afterEach(() => { document.body.innerHTML = ''; });
it('captures and restores an exact range across nested inline elements', () => {
  document.body.innerHTML = '<p>one <b>two</b> three two</p>';
  const node = document.querySelector('p')!;
  const range = document.createRange(); range.setStart(node.firstChild!, 2); range.setEnd(node.querySelector('b')!.firstChild!, 3);
  const anchor = { kind: 'html-node' as const, v: 1 as const, revision: '1', nodeId: 'n1', quote: 'e two', range: captureHtmlRange(node, range) };
  expect(anchor.range).toMatchObject({ start: 2, end: 7, length: 17 });
  const resolved = resolveHtmlRange(node, anchor);
  expect(resolved.status).toBe('exact'); expect(resolved.range?.toString()).toBe('e two');
});
it('relocates a unique quote but refuses repeated or deleted text', () => {
  const node = document.createElement('p'); node.textContent = 'new prefix quote suffix';
  const anchor = { kind: 'html-node' as const, v: 1 as const, revision: '1', nodeId: 'n1', quote: 'quote' };
  expect(resolveHtmlRange(node, anchor).range?.toString()).toBe('quote');
  node.textContent = 'quote quote'; expect(resolveHtmlRange(node, anchor).status).toBe('ambiguous');
  node.textContent = 'gone'; expect(resolveHtmlRange(node, anchor).status).toBe('missing');
});

it('maps a unique canonical quote back across changed whitespace', () => {
  const node = document.createElement('p'); node.innerHTML = 'before <b>two</b>\n  words after';
  const anchor = { kind: 'html-node' as const, v: 1 as const, revision: '1', nodeId: 'n1', quote: 'two words' };
  expect(resolveHtmlRange(node, anchor).range?.toString()).toBe('two\n  words');
});

it('restores a migrated forward endpoint at the next text node instead of the preceding wrapper',()=>{
 document.body.innerHTML='<p><af-text>Keep \n </af-text><strong><af-text>bold</af-text></strong> tail</p>';
 const node=document.querySelector('p')!,text=node.textContent!,anchor={kind:'html-node' as const,v:1 as const,revision:'1',nodeId:'p',quote:'Keep ',range:{start:0,end:7,length:text.length,fingerprint:htmlTextFingerprint(text)}};
 const resolved=resolveHtmlRange(node,anchor,{endAffinity:'forward'});
 expect(resolved.range?.endContainer).toBe(node.querySelector('strong af-text')!.firstChild);
 expect(resolved.range?.endOffset).toBe(0);
 expect(resolved.range?.toString()).toBe('Keep \n ');
 expect(resolveHtmlRange(node,anchor).range?.endContainer).toBe(node.querySelector('af-text')!.firstChild);
});
