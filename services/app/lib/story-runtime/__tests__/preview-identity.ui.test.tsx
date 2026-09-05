import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { parseJsx } from '@/lib/jsx';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { createPreviewIdentityAllocator } from '../preview-identity';

describe('production preview identity', () => {
  it('isolates local references and preserves main IDs, external references and source AST', () => {
    const parsed = parseJsx('<section id="panel" aria-labelledby="title outside"><h2 id="title">T</h2><label for="field">F</label><input id="field" /><a href="#title">Local</a><a href="https://example.com/#title">External</a><svg><defs><linearGradient id="paint" /></defs><rect fill="url(#paint)" /></svg></section>');
    if (!parsed.ok) throw new Error(parsed.error);
    const before = JSON.stringify(parsed.nodes);
    const allocate = createPreviewIdentityAllocator(parsed.nodes, 'rail');
    const { container } = render(<><main>{renderStoryNodes(parsed.nodes, {components:{}})}</main><aside>{renderStoryNodes(parsed.nodes, {components:{},decorateElement:allocate(parsed.nodes,'one')})}</aside><aside>{renderStoryNodes(parsed.nodes, {components:{},decorateElement:allocate(parsed.nodes,'two')})}</aside></>);
    const ids = [...container.querySelectorAll('[id]')].map(n=>n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(container.querySelector('main section')?.id).toBe('panel');
    for (const aside of container.querySelectorAll('aside')) {
      expect(aside.querySelector('label')?.htmlFor).toBe(aside.querySelector('input')?.id);
      expect(aside.querySelector('section')?.getAttribute('aria-labelledby')).toBe(`${aside.querySelector('h2')?.id} outside`);
      expect(aside.querySelector('a')?.getAttribute('href')).toBe(`#${aside.querySelector('h2')?.id}`);
      expect(aside.querySelectorAll('a')[1].getAttribute('href')).toBe('https://example.com/#title');
      expect(aside.querySelector('rect')?.getAttribute('fill')).toBe(`url(#${aside.querySelector('linearGradient')?.id})`);
    }
    expect(JSON.stringify(parsed.nodes)).toBe(before);
  });
});
