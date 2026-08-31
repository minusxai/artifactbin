/**
 * StoryFormatToolbar — the spacing row (margins above/below, padding
 * left/right, width). The toolbar holds no element — it derives everything
 * from the selection DESCRIPTION and reports one class string per change —
 * so these tests are pure props-in / onApply-out, over the same class
 * algebra the document applies (lib/data/story/typography).
 */
import React from 'react';
import { screen, fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import StoryFormatToolbar from '../StoryFormatToolbar';
import type { StoryEditSelection } from '@/lib/story-runtime/contract';

function renderToolbar(className = '', rect = { x: 40, y: 300, width: 600, height: 80 }) {
  const selection: StoryEditSelection = {
    kind: 'element', path: '0.1', tag: 'div',
    rect,
    className, style: '', ancestors: [],
  };
  const onApply = vi.fn();
  render(
    <StoryFormatToolbar
      selection={selection}
      frameRef={{ current: null }}
      onApply={onApply}
      onApplyLink={vi.fn()}
      onSelect={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  return { onApply };
}

const lastClass = (onApply: ReturnType<typeof vi.fn>): string =>
  (onApply.mock.calls.at(-1)?.[1] as { className: string }).className;

const showMore = (index = 0) => fireEvent.click(screen.getAllByLabelText('More formatting controls')[index]);

describe('StoryFormatToolbar spacing row', () => {
  it('steps the four spacing edges independently', () => {
    const { onApply } = renderToolbar('mt-4');
    const toolbar = screen.getByLabelText('Typography toolbar');
    const breadcrumb = screen.getByLabelText('Selection breadcrumb');
    const primary = screen.getByLabelText('Primary formatting controls');
    expect(toolbar.firstElementChild).toBe(breadcrumb);
    expect(breadcrumb.nextElementSibling).toBe(primary);
    expect(screen.getByLabelText('Align left')).toHaveAttribute('data-slot', 'tooltip-trigger');
    expect(screen.getByLabelText('Align left')).not.toHaveAttribute('data-tip');
    expect(screen.queryByLabelText('Decrease space above')).toBeNull();
    showMore();
    expect(screen.getByLabelText('Spacing and width controls')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Increase space above'));
    expect(lastClass(onApply)).toBe('mt-6');
    fireEvent.click(screen.getByLabelText('Increase space below'));
    expect(lastClass(onApply)).toBe('mt-4 mb-1');
    fireEvent.click(screen.getByLabelText('Increase space left'));
    expect(lastClass(onApply)).toBe('mt-4 pl-1');
    fireEvent.click(screen.getByLabelText('Increase space right'));
    expect(lastClass(onApply)).toBe('mt-4 pr-1');
  });

  it('steps width along the max-w scale; unconstrained reads full and narrows from 7xl', () => {
    const { onApply } = renderToolbar('max-w-prose');
    showMore();
    fireEvent.click(screen.getByLabelText('Increase width'));
    expect(lastClass(onApply)).toBe('max-w-2xl');
    fireEvent.click(screen.getByLabelText('Decrease width'));
    expect(lastClass(onApply)).toBe('max-w-xl');

    const bare = renderToolbar('');
    showMore(1);
    fireEvent.click(screen.getAllByLabelText('Decrease width')[1]);
    expect(lastClass(bare.onApply)).toBe('max-w-7xl');
  });

  it('shows the readouts (px for edges, the max-w tail or full for width)', () => {
    renderToolbar('mt-4 pl-2 max-w-prose');
    showMore();
    const toolbar = screen.getByLabelText('Typography toolbar');
    expect(toolbar.textContent).toContain('16px'); // mt-4
    expect(toolbar.textContent).toContain('8px'); // pl-2
    expect(toolbar.textContent).toContain('prose');
  });
});

describe('StoryFormatToolbar placement', () => {
  const toolbarTop = () => parseFloat((screen.getAllByLabelText('Typography toolbar').at(-1) as HTMLElement).style.top);
  const toolbarLeft = () => parseFloat((screen.getAllByLabelText('Typography toolbar').at(-1) as HTMLElement).style.left);

  it('centers above the selection when there is room below the edit bars', () => {
    renderToolbar('', { x: 40, y: 300, width: 600, height: 80 });
    expect(toolbarTop()).toBeLessThan(300); // above the element's top edge
    expect(toolbarTop()).toBeGreaterThan(81); // and clear of topbar + edit bar
    expect(toolbarLeft()).toBe(40 + 600 / 2 - 408 / 2);
  });

  it('flips BELOW the selection when above would land on the fixed bars or the text', () => {
    renderToolbar('', { x: 40, y: 60, width: 600, height: 80 });
    // Never over the element: below its bottom edge, plus the 8px gap.
    expect(toolbarTop()).toBe(60 + 80 + 8);
  });

  it('clamps horizontally when a centered toolbar would leave the viewport', () => {
    renderToolbar('', { x: 980, y: 300, width: 80, height: 40 });
    expect(toolbarLeft()).toBe(window.innerWidth - 408 - 8);
  });
});
