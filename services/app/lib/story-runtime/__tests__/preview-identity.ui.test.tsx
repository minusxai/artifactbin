import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { parseJsx } from '@/lib/jsx';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { createPreviewIdentityAllocator } from '../preview-identity';
import { StoryRuntimeApp } from '../StoryRuntimeApp';

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

  it('rewrites the complete supported IDREF surface, quoted SVG URLs, and only local targets', () => {
    const parsed = parseJsx('<div id="root" aria-activedescendant="item" aria-details="detail outside" aria-errormessage="error" aria-flowto="item outside"><span id="item" /><span id="detail" /><span id="error" /><output for="item outside" /><svg><defs><filter id="fx" /><marker id="dot" /></defs><path filter="url( \'#fx\' )" markerEnd="url(&quot;#dot&quot;)" stroke="url(#outside)" /></svg></div>');
    if (!parsed.ok) throw new Error(parsed.error);
    const allocate = createPreviewIdentityAllocator(parsed.nodes, 'grammar');
    const { container } = render(<>{renderStoryNodes(parsed.nodes, { components: {}, decorateElement: allocate(parsed.nodes, 'one') })}</>);
    const root = container.querySelector('div[id]')!;
    const spans = [...container.querySelectorAll('span[id]')];
    const [itemId, detailId, errorId] = spans.map((span) => span.id);
    expect(root.getAttribute('aria-activedescendant')).toBe(itemId);
    expect(root.getAttribute('aria-details')).toBe(`${detailId} outside`);
    expect(root.getAttribute('aria-errormessage')).toBe(errorId);
    expect(root.getAttribute('aria-flowto')).toBe(`${itemId} outside`);
    expect(container.querySelector('output')?.getAttribute('for')).toBe(`${itemId} outside`);
    expect(container.querySelector('path')?.getAttribute('filter')).toContain(`#${container.querySelector('filter')?.id}`);
    expect(container.querySelector('path')?.getAttribute('marker-end')).toContain(`#${container.querySelector('marker')?.id}`);
    expect(container.querySelector('path')?.getAttribute('stroke')).toBe('url(#outside)');
  });

  it('allocates around an authored ID that collides with its preferred generated name', () => {
    const local = parseJsx('<div id="target" />');
    if (!local.ok) throw new Error(local.error);
    const first = createPreviewIdentityAllocator(local.nodes, 'rail');
    const probe = render(<>{renderStoryNodes(local.nodes, { components: {}, decorateElement: first(local.nodes, 'one') })}</>);
    const preferred = probe.container.firstElementChild!.id;
    probe.unmount();
    const adversarial = parseJsx(`<><i id="${preferred}" /><div id="target" /></>`);
    if (!adversarial.ok) throw new Error(adversarial.error);
    const allocate = createPreviewIdentityAllocator(adversarial.nodes, 'rail');
    const { container } = render(<>{renderStoryNodes(adversarial.nodes, { components: {}, decorateElement: allocate([adversarial.nodes[1]], 'one') })}</>);
    expect(container.querySelector('div')?.id).not.toBe(preferred);
  });

  it('installs distinct stable namespaces only in actual SlideRail previews', () => {
    const parsed = parseJsx('<SlideDeck><Slide title="One"><section id="panel-one" aria-labelledby="title-one"><h2 id="title-one">One</h2></section></Slide><Slide title="Two"><section id="panel-two" aria-labelledby="title-two"><h2 id="title-two">Two</h2></section></Slide></SlideDeck>');
    if (!parsed.ok) throw new Error(parsed.error);
    const app = <StoryRuntimeApp nodes={parsed.nodes} refData={{}} colorMode="light" />;
    const { container, rerender } = render(app);
    const mainIds = [...container.querySelectorAll('.mx-doc [id]')].map((el) => el.id);
    expect(mainIds).toEqual(['panel-one', 'title-one', 'panel-two', 'title-two']);
    const previewIds = [...container.querySelectorAll('.mx-rail-thumb [id]')].map((el) => el.id);
    expect(previewIds).toHaveLength(4);
    expect(new Set([...mainIds, ...previewIds]).size).toBe(8);
    for (const thumb of container.querySelectorAll('.mx-rail-thumb')) {
      expect(thumb.querySelector('section section')?.getAttribute('aria-labelledby')).toBe(thumb.querySelector('h2')?.id);
    }
    rerender(<StoryRuntimeApp nodes={parsed.nodes} refData={{}} colorMode="light" />);
    expect([...container.querySelectorAll('.mx-rail-thumb [id]')].map((el) => el.id)).toEqual(previewIds);
  });
});
