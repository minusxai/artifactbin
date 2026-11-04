/* @jsxImportSource solid-js */
/** ui/Toolbar: a named toolbar whose arrow keys move between its enabled controls, and whose plain buttons keep the focus where it was on a press. */
import { expect, it } from 'vitest';
import { fireEvent } from '@testing-library/dom';
import { render } from '../../__tests__/helpers';
import { Button } from '../Button';
import { Toolbar, ToolbarSeparator } from '../Toolbar';

it('moves the focus with ArrowLeft/ArrowRight (wrapping), Home and End, skipping disabled controls', () => {
  const view = render(() => <Toolbar label="Formatting"><Button size="sm">One</Button><Button size="sm" disabled>Off</Button><ToolbarSeparator /><Button size="sm">Two</Button><Button size="sm">Three</Button></Toolbar>);
  const bar = view.getByRole('toolbar', { name: 'Formatting' });
  expect(bar).toHaveAttribute('aria-orientation', 'horizontal');
  expect(view.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
  const [one, , two, three] = view.getAllByRole('button');
  one!.focus();
  fireEvent.keyDown(one!, { key: 'ArrowRight' });
  expect(two).toHaveFocus();
  fireEvent.keyDown(two!, { key: 'End' });
  expect(three).toHaveFocus();
  fireEvent.keyDown(three!, { key: 'ArrowRight' });
  expect(one).toHaveFocus();
  fireEvent.keyDown(one!, { key: 'ArrowLeft' });
  expect(three).toHaveFocus();
  fireEvent.keyDown(three!, { key: 'Home' });
  expect(one).toHaveFocus();
});

it('with keepFocus a press on a plain button keeps the focus, and a popup trigger still takes it', () => {
  const view = render(() => <Toolbar label="Formatting" keepFocus><Button size="sm">Bold</Button><Button size="sm" aria-haspopup="true">Style</Button></Toolbar>);
  expect(fireEvent.mouseDown(view.getByRole('button', { name: 'Bold' }))).toBe(false);
  expect(fireEvent.mouseDown(view.getByRole('button', { name: 'Style' }))).toBe(true);
  const plain = render(() => <Toolbar label="Plain"><Button size="sm">Bold</Button></Toolbar>);
  expect(fireEvent.mouseDown(plain.getByRole('button', { name: 'Bold' }))).toBe(true);
});
