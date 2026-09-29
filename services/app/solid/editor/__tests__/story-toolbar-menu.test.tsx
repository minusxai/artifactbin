/* @jsxImportSource solid-js */
/** components/views/story/StoryToolbarMenu.tsx port: the popover shell every editor menu shares. */
import { screen, fireEvent } from '@testing-library/dom';
import { expect, it } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from '@/solid/__tests__/helpers';
import { StoryToolbarMenu } from '../StoryToolbarMenu';

function Harness(props: { hint?: boolean }) {
  const [open, setOpen] = createSignal(false);
  return (
    <StoryToolbarMenu label="Align" name="Alignment" hint={props.hint} open={open()} onOpenChange={setOpen}>
      <button type="button">inside</button>
    </StoryToolbarMenu>
  );
}

it('opens on click, showing the labelled panel, and closes on Escape', () => {
  render(() => <Harness />);
  expect(screen.queryByLabelText('Alignment options')).toBeNull();
  fireEvent.click(screen.getByLabelText('Alignment'));
  expect(screen.getByLabelText('Alignment options')).toBeTruthy();
  fireEvent.keyDown(screen.getByLabelText('Alignment options'), { key: 'Escape' });
  expect(screen.queryByLabelText('Alignment options')).toBeNull();
});

it('closes on an outside click', () => {
  render(() => <Harness />);
  fireEvent.click(screen.getByLabelText('Alignment'));
  expect(screen.getByLabelText('Alignment options')).toBeTruthy();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByLabelText('Alignment options')).toBeNull();
});

it('hints with a dashed underline when asked', () => {
  render(() => <Harness hint />);
  expect(screen.getByLabelText('Alignment').className).toContain('underline');
});
