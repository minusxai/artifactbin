import React from 'react';
import {expect, it, vi, beforeEach} from 'vitest';
import {render, fireEvent, screen, waitFor} from '@testing-library/react';
import {Dialog, DialogTrigger, DialogContent, DialogClose} from '@/components/kit/dialog';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {this.open = true;};
  HTMLDialogElement.prototype.close = function () {this.open = false; this.dispatchEvent(new Event('close'));};
});

it('opens, cancels, and returns focus to the trigger', async () => {
  render(<Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Editor"><input aria-label="Name" autoFocus /><DialogClose>Cancel</DialogClose></DialogContent></Dialog>);
  const trigger = screen.getByText('Open');
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog', {name: 'Editor'})).toBeVisible();
  fireEvent.click(screen.getByText('Cancel'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(trigger).toHaveFocus();
});

it('keeps a pending submission open, shows rejection, and closes only after success', async () => {
  let reject!: (error: Error) => void;
  const submit = vi.fn(() => new Promise<void>((_resolve, no) => {reject = no;}));
  render(<Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Editor" onSubmitMutation={submit}><input aria-label="Name" required /><button type="submit">Save</button><DialogClose>Cancel</DialogClose></DialogContent></Dialog>);
  fireEvent.click(screen.getByText('Open'));
  const dialog = screen.getByRole('dialog');
  const form = dialog.querySelector('form')!;
  fireEvent.submit(form);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'Test'}});
  fireEvent.submit(form);
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  fireEvent(dialog, new Event('cancel', {cancelable: true}));
  expect(dialog).toHaveAttribute('open');
  reject(new Error('Write refused'));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('Write refused');
  expect(dialog).toHaveAttribute('open');
  submit.mockImplementation(async () => {});
  fireEvent.submit(form);
  await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
});
