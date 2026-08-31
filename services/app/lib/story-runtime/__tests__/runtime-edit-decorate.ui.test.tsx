/**
 * The two decorators the runtime applies, COMPOSED.
 *
 * `StoryRuntimeApp` resolves `ref:<id>` props (an <img src>, a <Video poster>);
 * edit mode wraps on top of that to make text hosts editable and to take the
 * link off a video card. Each is covered on its own elsewhere — what is not, is
 * that turning one on does not turn the other off. An author editing a document
 * whose posters had become broken images would be a regression neither
 * decorator's own tests could see.
 *
 * (Composition, not ORDER: edit mode's wrapping preserves the props the ref
 * resolution reads, so the two currently commute. This pins the outcome, which
 * is the thing that must hold either way.)
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { StoryRuntimeApp } from '../StoryRuntimeApp';
import { createFrameEditSession } from '../edit/session';
import type { PristineChannel } from '../pristine';

const nodesOf = (src: string): JsxNode[] => {
  const p = parseJsx(src);
  if (!p.ok) throw new Error('fixture does not parse');
  return p.nodes;
};

const channel: PristineChannel = {
  nonce: 'a'.repeat(32),
  post: () => {},
  innerHtmlOf: (el) => el.innerHTML,
  isParent: () => true,
  isFromParent: () => true,
};

const SRC = '<div className="p-8">'
  + '<img src="ref:img123" alt="a picture" />'
  + '<Video src="https://www.youtube.com/watch?v=dQw4w9WgXcQ" poster="ref:img123" title="a talk" />'
  + '</div>';
const REF_DATA = { img123: { kind: 'image' as const, url: '/a/img123/raw' } };

describe('edit mode decorates the element the reader sees', () => {
  it('keeps ref: props resolved, and still makes the video non-interactive', () => {
    const session = createFrameEditSession({ win: window, channel, requestRender: vi.fn() });
    try {
      const nodes = nodesOf(SRC);
      session.setNodes(nodes);
      const view = render(
        <StoryRuntimeApp
          nodes={nodes}
          refData={REF_DATA}
          colorMode="light"
          chrome={false}
          editDecorate={session.decorate}
        />,
      );
      const img = view.container.querySelector('img[alt="a picture"]') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('/a/img123/raw');

      const video = view.container.querySelector('[data-mx-ast="0.1"]') as HTMLElement;
      // Resolved by the runtime's decorator...
      expect(video.querySelector('img')?.getAttribute('src')).toBe('/a/img123/raw');
      // ...and made selectable rather than clickable by edit mode's, on top.
      expect(video.querySelector('a')).toBeNull();
    } finally {
      session.dispose();
    }
  });

  it('resolves those refs for the READER too — edit mode is not what makes it work', () => {
    const view = render(
      <StoryRuntimeApp nodes={nodesOf(SRC)} refData={REF_DATA} colorMode="light" chrome={false} />,
    );
    const video = view.container.querySelector('[data-mx-ast="0.1"]') as HTMLElement;
    expect(video.querySelector('img')?.getAttribute('src')).toBe('/a/img123/raw');
    expect(video.querySelector('a')).not.toBeNull();   // the reader's card IS a link
  });
});
