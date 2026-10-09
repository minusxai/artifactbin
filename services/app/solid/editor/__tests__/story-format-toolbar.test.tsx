/* @jsxImportSource solid-js */
/**
 * components/views/story/__tests__/format-toolbar-spacing.ui.test.tsx PORTED to the Solid toolbar.
 * Same cases and assertions, minus one Radix implementation detail this port has no equivalent for
 * (`data-slot="tooltip-trigger"` — a Radix-only attribute; solid/components/Tooltip's own open/close
 * behavior is exercised instead, indirectly, by the Escape-closes-the-menu assertion). The React test
 * wraps the toolbar in `ArtifactBackendProvider`; this Solid toolbar takes `backend` as a prop instead
 * (see the DEVIATION note in StoryFormatToolbar.tsx), so the wrapper is replaced with a direct prop.
 */
import { createSignal } from 'solid-js';
import { screen, fireEvent } from '@testing-library/dom';
import { expect, it, vi } from 'vitest';
import { render } from '@/solid/__tests__/helpers';
import StoryFormatToolbar from '../StoryFormatToolbar';
import type { StoryEditSelection } from '@/lib/story-runtime/contract';

function renderToolbar(className = '', rect = { x: 40, y: 300, width: 600, height: 80 }) {
  const selection: StoryEditSelection = { kind: 'element', path: '0.1', tag: 'div', rect, className, style: '', ancestors: [] };
  const onApply = vi.fn();
  render(() => (
    <StoryFormatToolbar
      selection={selection}
      onApply={onApply}
      onApplyLink={vi.fn()}
      onSelect={vi.fn()}
      onDelete={vi.fn()}
      backend={{ mentionsUnavailable: null }}
    />
  ));
  return { onApply };
}

const lastClass = (onApply: ReturnType<typeof vi.fn>): string => (onApply.mock.calls.at(-1)?.[1] as { className: string }).className;
const showMore = (index = 0) => fireEvent.click(screen.getAllByLabelText('More formatting controls')[index]);

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
  expect(screen.getByLabelText('Align left')).toBeTruthy();
  fireEvent.keyDown(screen.getByLabelText('Alignment options'), { key: 'Escape' });
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
  expect(screen.getByLabelText('Spacing controls').textContent).toContain('16px');
  expect(screen.getByLabelText('Spacing controls').textContent).toContain('8px');
  expect(screen.queryByLabelText('Increase width')).toBeNull();
  expect(screen.queryByLabelText('Decrease width')).toBeNull();
});

it('stays in its toolbar slot independently of selection geometry', () => {
  renderToolbar('', { x: 980, y: 900, width: 80, height: 40 });
  const toolbar = screen.getByLabelText('Typography toolbar');
  expect(toolbar.style.top).toBe('');
  expect(toolbar.style.left).toBe('');
  expect(toolbar.classList.contains('fixed')).toBe(false);
});

const TEXT_ONLY = ['Decrease font size', 'Increase font size', 'Toggle bold', 'Toggle italic', 'Toggle underline', 'Text color', 'Insert link', 'Mention person', 'Remove link'];

function renderImage(alt: string | null) {
  const selection: StoryEditSelection = { kind: 'element', path: '0.3', tag: 'img', rect: { x: 0, y: 0, width: 100, height: 100 }, className: 'my-6 w-1/2 rounded-xl', style: '', ancestors: [] };
  const image = { alt, onReplace: vi.fn(), onAlt: vi.fn() };
  render(() => (
    <StoryFormatToolbar artifactId="doc1" selection={selection} onApply={vi.fn()} onApplyLink={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn()} onComment={vi.fn()} image={image} backend={{ mentionsUnavailable: null }} />
  ));
  return image;
}

it('offers Replace, Alt text, Align, Spacing, Comment and delete — and no text controls', () => {
  renderImage('A chart');
  expect(screen.getByLabelText('Selection breadcrumb').textContent).toContain('Image');
  for (const name of ['Replace image', 'Alt text', 'Alignment', 'More formatting controls', 'Comment on selection', 'Delete element']) expect(screen.getByLabelText(name)).toBeTruthy();
  for (const name of TEXT_ONLY) expect(screen.queryByLabelText(name)).toBeNull();
});

it('Replace opens the replace dialog — one button, no menu', () => {
  const image = renderImage('A chart');
  fireEvent.click(screen.getByLabelText('Replace image'));
  expect(image.onReplace).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Replace image options')).toBeNull();
});

it('hints when the image has no alt text, and commits an edit once', () => {
  const image = renderImage(null);
  const button = screen.getByLabelText('Add alt text');
  expect(button.textContent).toContain('Add alt text');
  fireEvent.click(button);
  const field = screen.getByLabelText('Image alt text') as HTMLInputElement;
  expect(field.value).toBe('');
  fireEvent.input(field, { target: { value: 'A red square' } });
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(image.onAlt).toHaveBeenCalledTimes(1);
  expect(image.onAlt).toHaveBeenCalledWith('A red square');
});

it('edits and clears existing alt text; Escape changes nothing', () => {
  const image = renderImage('A chart');
  fireEvent.click(screen.getByLabelText('Alt text'));
  const field = screen.getByLabelText('Image alt text') as HTMLInputElement;
  expect(field.value).toBe('A chart');
  fireEvent.input(field, { target: { value: 'discarded' } });
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(image.onAlt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Alt text'));
  fireEvent.input(screen.getByLabelText('Image alt text'), { target: { value: '' } });
  fireEvent.click(screen.getByLabelText('Save alt text'));
  expect(image.onAlt).toHaveBeenCalledWith('');
});

it('leaves a text selection exactly as it was', () => {
  render(() => (
    <StoryFormatToolbar artifactId="doc1" selection={{ kind: 'text', path: '0.1', tag: 'p', rect: { x: 0, y: 0, width: 1, height: 1 }, className: '', style: '', ancestors: [] }}
      onApply={vi.fn()} onApplyLink={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn()} backend={{ mentionsUnavailable: null }} />
  ));
  for (const name of TEXT_ONLY) expect(screen.getByLabelText(name)).toBeTruthy();
  expect(screen.queryByLabelText('Replace image')).toBeNull();
  expect(screen.queryByLabelText('Alt text')).toBeNull();
  expect(screen.queryByLabelText('Add alt text')).toBeNull();
});

it('disables Mention person with the reason when mentions are unavailable', () => {
  render(() => (
    <StoryFormatToolbar artifactId="doc1" selection={{ kind: 'text', path: '0', tag: 'p', rect: { x: 0, y: 100, width: 200, height: 40 }, className: '', style: '', ancestors: [] }}
      onApply={vi.fn()} onApplyLink={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn()} backend={{ mentionsUnavailable: 'Not available in a downloaded file.' }} />
  ));
  const mention = screen.getByRole('button', { name: 'Mention person' });
  expect(mention).toBeDisabled();
  expect(mention).toHaveAccessibleDescription('Not available in a downloaded file.');
});

it('uses the shared block dropdown and follows the current Markdown selection', () => {
  const [block, setBlock] = createSignal<'h2' | 'paragraph'>('h2');
  const onMarkdownBlock = vi.fn();
  render(() => <StoryFormatToolbar
    selection={{ kind: 'text', editor: 'markdown', tag: 'Markdown', markdownBlock: block(), path: '0.1', rect: { x: 0, y: 0, width: 100, height: 40 }, className: '', style: '', ancestors: [] }}
    onMarkdownBlock={onMarkdownBlock} onApply={vi.fn()} onApplyLink={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn()} />);
  const trigger = screen.getByRole('button', { name: 'Markdown block style' });
  expect(trigger).toHaveTextContent('Heading 2');
  fireEvent.click(trigger);
  expect(screen.getByRole('option', { name: 'Heading 2' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('option', { name: 'Quote' }));
  expect(onMarkdownBlock).toHaveBeenCalledWith('quote');
  expect(screen.queryByRole('listbox')).toBeNull();
  setBlock('paragraph');
  expect(screen.getByRole('button', { name: 'Markdown block style' })).toHaveTextContent('Paragraph');
});


it('offers Markdown tables, checklists and dividers and routes table commands', () => {
  const [block, setBlock] = createSignal<'paragraph' | 'table'>('paragraph');
  const onMarkdownBlock = vi.fn(), onMarkdownTable = vi.fn();
  render(() => <StoryFormatToolbar
    selection={{ kind: 'text', editor: 'markdown', tag: 'Markdown', markdownBlock: block(), path: '0.1', rect: { x: 0, y: 0, width: 100, height: 40 }, className: '', style: '', ancestors: [] }}
    onMarkdownBlock={onMarkdownBlock} onMarkdownTable={onMarkdownTable} onApply={vi.fn()} onApplyLink={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Markdown block style' }));
  expect(screen.getByRole('option', { name: 'Checklist' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Horizontal rule' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: 'Table' }));
  expect(onMarkdownBlock).toHaveBeenCalledWith('table');
  setBlock('table');
  expect(screen.getByRole('button', { name: 'Markdown block style' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add row below' }));
  expect(onMarkdownTable).toHaveBeenCalledWith('row-after');
  fireEvent.click(screen.getByRole('button', { name: 'Delete column' }));
  expect(onMarkdownTable).toHaveBeenCalledWith('delete-column');
});
