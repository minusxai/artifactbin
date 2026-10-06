/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { MoveToFolderDialog } from '../MoveToFolderDialog';
import type { ShelfRow } from '@/lib/workspace/shelf';

const folder = (id: string, title: string, ancestor_ids: string[] = []): ShelfRow => ({id, title, ancestor_ids, format: 'folder', url: `/a/${id}`, version: 1, updated_at: ''});
const folders = [folder('reports', 'Reports'), folder('year', '2026', ['reports']), folder('drafts', 'Drafts', ['reports', 'year']), folder('design', 'Design')];
afterEach(cleanup);
const open = (over: Partial<Parameters<typeof MoveToFolderDialog>[0]> = {}) => {
  const onMove = vi.fn(async () => true), onClose = vi.fn();
  render(() => <MoveToFolderDialog title="Sales" artifactId="sales" currentParentId={null} folders={folders} onMove={onMove} onClose={onClose} {...over} />);
  return {onMove, onClose};
};

it('expands nested folders and moves only after confirming the selected destination', async () => {
  const {onMove} = open();
  expect(screen.getByRole('tree', {name: 'Destination folders'})).toBeVisible();
  expect(screen.queryByLabelText('Move to 2026')).toBeNull();
  fireEvent.click(screen.getByRole('button', {name: 'Expand Reports'}));
  const year = screen.getByRole('treeitem', {name: 'Move to 2026'});
  expect(year).toHaveAttribute('aria-level', '3');
  fireEvent.click(year);
  expect(screen.getByLabelText('Selected destination')).toHaveTextContent('Workspace / Reports / 2026');
  expect(onMove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: 'Move here'}));
  await waitFor(() => expect(onMove).toHaveBeenCalledWith('year'));
});

it('keeps ancestor context when filtering for a nested folder', () => {
  open();
  fireEvent.input(screen.getByLabelText('Filter folders'), {target: {value: 'Drafts'}});
  expect(screen.getByLabelText('Move to Reports')).toBeVisible();
  expect(screen.getByLabelText('Move to 2026')).toBeVisible();
  expect(screen.getByLabelText('Move to Drafts')).toBeVisible();
  expect(screen.queryByLabelText('Move to Design')).toBeNull();
  fireEvent.input(screen.getByLabelText('Filter folders'), {target: {value: 'missing'}});
  expect(screen.getByText('No folders match your search.')).toBeVisible();
});

it('shows the current location and prevents moving a folder into itself or descendants', () => {
  const {onMove} = open({artifactId: 'year', currentParentId: 'reports'});
  expect(screen.getByLabelText('Move to Reports')).toHaveAttribute('aria-current', 'location');
  expect(screen.getByRole('button', {name: 'Move here'})).toBeDisabled();
  expect(screen.getByLabelText('Move to 2026')).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByRole('button', {name: 'Expand 2026'}));
  expect(screen.getByLabelText('Move to Drafts')).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByLabelText('Move to Drafts'));
  expect(onMove).not.toHaveBeenCalled();
  expect(screen.getByRole('button', {name: 'Move here'})).toBeDisabled();
});

it('supports keyboard expansion and selection and cancellation makes no write', () => {
  const {onMove, onClose} = open();
  const reports = screen.getByLabelText('Move to Reports');
  reports.focus();
  fireEvent.keyDown(reports, {key: 'ArrowRight'});
  fireEvent.keyDown(reports, {key: 'ArrowRight'});
  expect(screen.getByLabelText('Move to 2026')).toHaveFocus();
  fireEvent.keyDown(screen.getByLabelText('Move to 2026'), {key: 'Enter'});
  expect(screen.getByLabelText('Move to 2026')).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('button', {name: 'Close folder picker'}));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onMove).not.toHaveBeenCalled();
});

it('keeps the selected destination and shows an error when a move fails', async () => {
  const onMove = vi.fn(async () => false);
  open({onMove});
  fireEvent.click(screen.getByLabelText('Move to Design'));
  fireEvent.click(screen.getByRole('button', {name: 'Move here'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not move');
  expect(screen.getByLabelText('Move to Design')).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', {name: 'Move here'})).toBeEnabled();
});
