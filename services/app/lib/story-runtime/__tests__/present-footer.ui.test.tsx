/** The deck's fixed controls must yield as the in-document credits enter view. */
import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { StoryRuntimeApp } from '../StoryRuntimeApp';

const parsed = parseJsx(`
  <SlideDeck>
    <Slide title="One"><h1>One</h1></Slide>
    <Slide title="Two"><h1>Two</h1></Slide>
  </SlideDeck>
`);
if (!parsed.ok) throw new Error(parsed.error);

const bounds = (top: number, bottom: number): DOMRect => ({
  x: 0,
  y: top,
  top,
  bottom,
  left: 0,
  right: 100,
  width: 100,
  height: bottom - top,
  toJSON: () => ({}),
});

describe('the deck present bar and artifact footer', () => {
  it('adds the visible footer height to the controls\' bottom inset', () => {
    const { container } = render(
      <>
        <StoryRuntimeApp nodes={parsed.nodes} refData={{}} colorMode="light" />
        <footer className="mx-artifact-credits">credits</footer>
      </>,
    );
    const footer = container.querySelector<HTMLElement>('.mx-artifact-credits')!;
    const controls = container.querySelector<HTMLElement>('.mx-present')!;
    const rect = vi.spyOn(footer, 'getBoundingClientRect');

    rect.mockReturnValue(bounds(window.innerHeight - 20, window.innerHeight + 32));
    act(() => window.dispatchEvent(new Event('scroll')));
    expect(controls.style.getPropertyValue('--mx-footer-inset')).toBe('20px');

    rect.mockReturnValue(bounds(window.innerHeight - 52, window.innerHeight));
    act(() => window.dispatchEvent(new Event('scroll')));
    expect(controls.style.getPropertyValue('--mx-footer-inset')).toBe('52px');

    rect.mockReturnValue(bounds(window.innerHeight + 1, window.innerHeight + 53));
    act(() => window.dispatchEvent(new Event('scroll')));
    expect(controls.style.getPropertyValue('--mx-footer-inset')).toBe('0px');
  });
});
