/* @jsxImportSource solid-js */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { screen } from '@testing-library/dom';
import { STORY_SYSTEMS } from '@/lib/story-design/story-systems';
import type { StoryDesignName } from '@/lib/validation/story-theme-names';
import ThemePicker, { ModeChip, TemplateChip } from '../ThemePicker';

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
afterEach(() => vi.unstubAllGlobals());

it('offers every current system as a thumbnail, with the existing system selected', () => {
  render(() => <ThemePicker value="signout" onPick={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Design system' }));
  for (const system of STORY_SYSTEMS) {
    const option = screen.getByRole('button', { name: `Design system ${system.label}` });
    expect(option).toHaveAttribute('aria-pressed', String(system.name === 'signout'));
    expect(option.querySelector('[data-design-specimen]')).not.toBeNull();
    expect(option.querySelector('img')).toHaveAttribute('src', `/design-systems/${system.name}${system.defaultMode === 'dark' ? '-dark' : ''}.webp`);
  }
  expect(document.querySelector('link[href*="design-system"]')).toBeNull();
  expect(screen.queryByRole('button', { name: /Modernist/ })).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByLabelText('Design systems', { exact: true })).toBeNull();
});

it('picks a system and can undo back to the existing legacy design', () => {
  const picked = vi.fn();
  render(() => {
    const [value, setValue] = createSignal<StoryDesignName | null>('modernist');
    return <ThemePicker value={value()} onPick={next => { picked(next); setValue(next); }} />;
  });
  expect(screen.getByRole('button', { name: 'Design system' })).toHaveTextContent('Modernist');
  fireEvent.click(screen.getByRole('button', { name: 'Design system' }));
  fireEvent.click(screen.getByRole('button', { name: 'Design system Volta' }));
  expect(picked).toHaveBeenLastCalledWith('volta');
  expect(screen.queryByLabelText('Design systems', { exact: true })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Undo design change' }));
  expect(picked).toHaveBeenLastCalledWith('modernist');
});

it('resolves each specimen in the document mode without putting design tokens on the editor', () => {
  render(() => <ThemePicker value="signout" colorMode="dark" onPick={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Design system' }));
  for (const system of STORY_SYSTEMS) {
    const option = screen.getByRole('button', { name: `Design system ${system.label}` });
    const specimen = option.querySelector<HTMLElement>('[data-design-specimen]')!;
    expect(specimen.querySelector('img')).toHaveAttribute('src', `/design-systems/${system.name}-dark.webp`);
    expect(specimen.style.getPropertyValue('--font-display')).toBe('');
    expect(option.style.getPropertyValue('--background')).toBe('');
  }
});

it('picks the document color mode from the shared listbox, with the theme default as the unset choice', () => {
  const onPick = vi.fn();
  render(() => <ModeChip mode={null} themeDefault="dark" onPick={onPick} />);
  const trigger = screen.getByRole('button', { name: 'Color mode' });
  expect(trigger).toHaveTextContent('system default (dark)');
  fireEvent.click(trigger);
  expect(screen.getByRole('option', { name: 'system default (dark)' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('option', { name: 'light' }));
  expect(onPick).toHaveBeenLastCalledWith('light');
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('option', { name: 'system default (dark)' }));
  expect(onPick).toHaveBeenLastCalledWith(null);
});

it('shows the chosen color mode and the page type as a badge', () => {
  render(() => <><ModeChip mode="dark" themeDefault="light" onPick={() => {}} /><TemplateChip template="dashboard" /></>);
  expect(screen.getByRole('button', { name: 'Color mode' })).toHaveTextContent('dark');
  expect(screen.getByLabelText('Page type: dashboard')).toHaveTextContent('dashboard');
});

it('draws the design trigger as a bordered Select-height control beside the Mode select', () => {
  render(() => <><ThemePicker value="modernist" onPick={() => {}} /><ModeChip mode={null} themeDefault="light" onPick={() => {}} /></>);
  const design = screen.getByRole('button', { name: 'Design system' });
  const mode = screen.getByRole('button', { name: 'Color mode' });
  for (const size of ['h-control-sm', 'rounded-control', 'border-edge-bright', 'bg-surface']) {
    expect(design.className).toContain(size);
    expect(mode.className).toContain(size);
  }
  expect(design).toHaveAttribute('aria-haspopup', 'true');
  expect(design).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(design);
  expect(design).toHaveAttribute('aria-expanded', 'true');
});
