import {afterEach, expect, it, vi} from 'vitest';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {SelectControl} from '../controls';

afterEach(() => vi.restoreAllMocks());

it('preserves artifact tokens and typography outside a clipping ancestor, including live overrides', async () => {
  const nativeComputedStyle = window.getComputedStyle.bind(window);
  // jsdom does not inherit custom properties. Model the browser's computed
  // cascade at the trigger while leaving the portal's styles observable.
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    const host = element.closest('[data-test-artifact]');
    return nativeComputedStyle(host ?? element);
  });
  const view = render(<div data-test-artifact="" data-theme="industry" style={{
    overflow: 'hidden', fontFamily: 'Inter, sans-serif', colorScheme: 'light',
    '--popover': '#fafafa', '--popover-foreground': '#222222',
    '--background': '#ffffff', '--accent': '#eeeeee', '--radius': '2px',
  } as React.CSSProperties}>
    <SelectControl label="Sprint" value="one" options={[{value:'one', label:'First sprint'}]} onChange={vi.fn()} />
  </div>);
  const host = view.container.firstElementChild as HTMLElement;
  fireEvent.click(screen.getByRole('button', {name:'Sprint'}));
  const popup = screen.getByRole('listbox').parentElement!;
  expect(popup.parentElement).toBe(document.body);
  expect(host.contains(popup)).toBe(false);
  expect(popup.style.position).toBe('fixed');
  expect(popup.style.getPropertyValue('--popover')).toBe('#fafafa');
  expect(popup.style.getPropertyValue('--popover-foreground')).toBe('#222222');
  expect(popup.style.getPropertyValue('--background')).toBe('#ffffff');
  expect(popup.style.getPropertyValue('--radius')).toBe('2px');
  expect(popup.style.fontFamily).toBe('Inter, sans-serif');
  expect(popup.style.colorScheme).toBe('light');

  await act(async () => {
    host.className = 'dark';
    host.style.setProperty('--popover', '#242424');
    host.style.setProperty('--popover-foreground', '#eeeeee');
    host.style.removeProperty('--accent');
    host.style.fontFamily = 'Georgia, serif';
    host.style.colorScheme = 'dark';
  });
  expect(popup.style.getPropertyValue('--popover')).toBe('#242424');
  expect(popup.style.getPropertyValue('--popover-foreground')).toBe('#eeeeee');
  expect(popup.style.getPropertyValue('--accent')).toBe('');
  expect(popup.style.fontFamily).toBe('Georgia, serif');
  expect(popup.style.colorScheme).toBe('dark');

  fireEvent.keyDown(screen.getByRole('searchbox'), {key:'Escape'});
  expect(screen.queryByRole('listbox')).toBeNull();
});
