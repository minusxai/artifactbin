/**
 * StoryFormatToolbar — the spacing row (margins above/below, padding
 * left/right, width). The toolbar holds no element — it derives everything
 * from the selection DESCRIPTION and reports one class string per change —
 * so these tests are pure props-in / onApply-out, over the same class
 * algebra the document applies (lib/data/story/typography).
 */
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
    expect(screen.getByLabelText('Spacing controls')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Increase space above'));
    expect(lastClass(onApply)).toBe('mt-6');
    fireEvent.click(screen.getByLabelText('Increase space below'));
    expect(lastClass(onApply)).toBe('mt-4 mb-1');
    fireEvent.click(screen.getByLabelText('Increase space left'));
    expect(lastClass(onApply)).toBe('mt-4 pl-1');
    fireEvent.click(screen.getByLabelText('Increase space right'));
    expect(lastClass(onApply)).toBe('mt-4 pr-1');
  });

  it('shows the readouts (px for edges, the max-w tail or full for width)', () => {
    renderToolbar('mt-4 pl-2 max-w-prose');
    showMore();
    const toolbar = screen.getByLabelText('Typography toolbar');
    expect(toolbar.textContent).toContain('16px'); // mt-4
    expect(toolbar.textContent).toContain('8px'); // pl-2
    expect(screen.queryByLabelText('Increase width')).toBeNull();
    expect(screen.queryByLabelText('Decrease width')).toBeNull();
  });
});

describe('StoryFormatToolbar placement', () => {
  it('stays in its toolbar slot independently of selection geometry', () => {
    renderToolbar('', {x:980,y:900,width:80,height:40});
    const toolbar=screen.getByLabelText('Typography toolbar');
    expect(toolbar.style.top).toBe('');
    expect(toolbar.style.left).toBe('');
    expect(toolbar.classList.contains('fixed')).toBe(false);
  });
});
