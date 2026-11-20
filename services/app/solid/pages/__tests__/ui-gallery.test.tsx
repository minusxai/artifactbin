/* @jsxImportSource solid-js */
/**
 * The development gallery (`/dev/ui`) draws every section, and each section's demos hold their own state: a switch
 * turns on, a version is chosen, a combobox filters people.
 */
import { expect, it } from 'vitest';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import UiGallery from '../UiGallery';

it('draws every section, and the demos in each keep their own state', () => {
  render(() => <UiGallery />);
  for (const title of ['Button', 'Fields', 'Toggles and tabs', 'Menus and overlays', 'Surfaces and text']) expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
  const toggle = screen.getByRole('switch', { name: 'Switch md' });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(toggle).toBeChecked();
  expect(screen.queryByRole('button', { name: 'Restore v2' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Preview version 2/ }));
  expect(screen.getByRole('button', { name: 'Restore v2' })).toBeInTheDocument();
});
