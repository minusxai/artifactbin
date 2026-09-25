/**
 * StoryFormatToolbar — the spacing row (margins above/below, padding
 * left/right). The toolbar holds no element — it derives everything
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
    kind: 'element',
    path: '0.1',
    tag: 'div',
    rect,
    className,
    style: '',
    ancestors: [],
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
    expect(primary.nextElementSibling).toContainElement(screen.getByLabelText('Delete element'));
    expect(breadcrumb).not.toContainElement(screen.getByLabelText('Delete element'));
    fireEvent.click(screen.getByLabelText('Alignment'));
    expect(screen.getByLabelText('Align left')).toHaveAttribute('data-slot', 'tooltip-trigger');
    expect(screen.getByLabelText('Align left')).not.toHaveAttribute('data-tip');
    fireEvent.keyDown(screen.getByLabelText('Alignment options'), {
      key: 'Escape',
    });
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

  it('shows a px readout for each edge, and offers no width control', () => {
    renderToolbar('mt-4 pl-2 max-w-prose');
    showMore();
    expect(screen.getByLabelText('Spacing controls').textContent).toContain('16px'); // mt-4
    expect(screen.getByLabelText('Spacing controls').textContent).toContain('8px'); // pl-2
    expect(screen.queryByLabelText('Increase width')).toBeNull();
    expect(screen.queryByLabelText('Decrease width')).toBeNull();
  });
});

describe('StoryFormatToolbar placement', () => {
  it('stays in its toolbar slot independently of selection geometry', () => {
    renderToolbar('', { x: 980, y: 900, width: 80, height: 40 });
    const toolbar = screen.getByLabelText('Typography toolbar');
    expect(toolbar.style.top).toBe('');
    expect(toolbar.style.left).toBe('');
    expect(toolbar.classList.contains('fixed')).toBe(false);
  });
});

/**
 * AN IMAGE IS NOT TEXT. Selecting one swaps the text vocabulary (size, weight,
 * colour, links) for what an image takes: replace the picture, describe it.
 * Layout (align, spacing), comment and delete stay, as for every block.
 */
describe('StoryFormatToolbar for a selected image', () => {
  const TEXT_ONLY = [
    'Decrease font size', 'Increase font size', 'Toggle bold', 'Toggle italic', 'Toggle underline',
    'Text color', 'Insert link', 'Mention person', 'Remove link',
  ];

  function renderImage(alt: string | null) {
    const selection: StoryEditSelection = {
      kind: 'element', path: '0.3', tag: 'img', rect: { x: 0, y: 0, width: 100, height: 100 },
      className: 'my-6 w-1/2 rounded-xl', style: '', ancestors: [],
    };
    const image = { alt, onReplaceFile: vi.fn(), onReplaceUrl: vi.fn(), onAlt: vi.fn() };
    render(
      <StoryFormatToolbar
        artifactId="doc1"
        selection={selection}
        onApply={vi.fn()}
        onApplyLink={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onComment={vi.fn()}
        image={image}
      />,
    );
    return image;
  }

  it('offers Replace, Alt text, Align, Spacing, Comment and delete — and no text controls', () => {
    renderImage('A chart');
    expect(screen.getByLabelText('Selection breadcrumb').textContent).toContain('Image');
    for (const name of ['Replace image', 'Alt text', 'Alignment', 'More formatting controls', 'Comment on selection', 'Delete element'])
      expect(screen.getByLabelText(name)).toBeTruthy();
    for (const name of TEXT_ONLY) expect(screen.queryByLabelText(name)).toBeNull();
  });

  it('replaces from a file or from a URL', () => {
    const image = renderImage('A chart');
    fireEvent.click(screen.getByLabelText('Replace image'));
    fireEvent.click(screen.getByLabelText('Replace image from file'));
    expect(image.onReplaceFile).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Replace image'));
    fireEvent.change(screen.getByLabelText('Replacement image URL'), { target: { value: 'https://example.com/b.png' } });
    fireEvent.click(screen.getByLabelText('Replace image from URL'));
    expect(image.onReplaceUrl).toHaveBeenCalledWith('https://example.com/b.png');
  });

  it('hints when the image has no alt text, and commits an edit once', () => {
    const image = renderImage(null);
    const button = screen.getByLabelText('Add alt text');
    expect(button.textContent).toContain('Add alt text');
    fireEvent.click(button);
    const field = screen.getByLabelText('Image alt text') as HTMLInputElement;
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: 'A red square' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(image.onAlt).toHaveBeenCalledTimes(1);
    expect(image.onAlt).toHaveBeenCalledWith('A red square');
  });

  it('edits and clears existing alt text; Escape changes nothing', () => {
    const image = renderImage('A chart');
    fireEvent.click(screen.getByLabelText('Alt text'));
    const field = screen.getByLabelText('Image alt text') as HTMLInputElement;
    expect(field.value).toBe('A chart');
    fireEvent.change(field, { target: { value: 'discarded' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(image.onAlt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Alt text'));
    fireEvent.change(screen.getByLabelText('Image alt text'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Save alt text'));
    expect(image.onAlt).toHaveBeenCalledWith('');
  });

  it('leaves a text selection exactly as it was', () => {
    render(
      <StoryFormatToolbar
        artifactId="doc1"
        selection={{ kind: 'text', path: '0.1', tag: 'p', rect: { x: 0, y: 0, width: 1, height: 1 }, className: '', style: '', ancestors: [] }}
        onApply={vi.fn()}
        onApplyLink={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    for (const name of TEXT_ONLY) expect(screen.getByLabelText(name)).toBeTruthy();
    expect(screen.queryByLabelText('Replace image')).toBeNull();
    expect(screen.queryByLabelText('Alt text')).toBeNull();
    expect(screen.queryByLabelText('Add alt text')).toBeNull();
  });
});
