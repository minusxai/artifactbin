/* @jsxImportSource solid-js */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { screen } from '@testing-library/dom';
import { STORY_SYSTEMS } from '@/lib/data/story/story-systems';
import type { StoryDesignName } from '@/lib/validation/story-theme-names';
import ThemePicker from '../ThemePicker';

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
afterEach(() => vi.unstubAllGlobals());

it('offers every current system as a live specimen, with the existing system selected', () => {
  render(() => <ThemePicker value="signout" onPick={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Design system' }));
  for (const system of STORY_SYSTEMS) {
    const option = screen.getByRole('button', { name: `Design system ${system.label}` });
    expect(option).toHaveAttribute('aria-pressed', String(system.name === 'signout'));
    expect(option.querySelector('[data-design-specimen]')).not.toBeNull();
    expect(option.querySelector('[data-design-specimen] svg'), option.innerHTML.slice(0, 1800)).toHaveAttribute('viewBox', '0 0 480 288');
    expect(option.querySelector('img')).toBeNull();
  }
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
    expect(specimen.style.getPropertyValue('--background')).toBe(system.darkCssVars['--background']);
    expect(specimen.style.getPropertyValue('--font-display')).toBe(system.cssVars['--font-display']);
    expect(option.style.getPropertyValue('--background')).toBe('');
  }
});
