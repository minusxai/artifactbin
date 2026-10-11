/* @jsxImportSource solid-js */
import { expect, it, vi } from 'vitest';
import { fireEvent, render } from '../../__tests__/helpers';
import { VersionHistory } from '../VersionHistory';

it('previews a row and offers restore only for the selected version', () => {
  const preview = vi.fn(); const restore = vi.fn(); const current = vi.fn();
  const view = render(() => <VersionHistory versions={[{ version: 2, title: 'Earlier', description: null, format: 'markup', created_at: new Date().toISOString(), by: 'ana' }]}
    currentVersion={3} previewing={2} onPreview={preview} onRestore={restore} onBackToCurrent={current} onClose={() => {}} busy={false} embedded />);
  expect(view.getByText('Restoring creates a new version and keeps the current version in history.')).toBeInTheDocument();
  fireEvent.click(view.getByRole('button', { name: 'Restore version 2' }));
  expect(restore).toHaveBeenCalledWith(2);
  expect(preview).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: 'Show the current version' }));
  expect(current).toHaveBeenCalledOnce();
});

it('lists the live document and each version as a selectable list; only the selected row owns restore', () => {
  const preview = vi.fn();
  const versions = [
    { version: 2, title: 'Earlier', description: null, format: 'markup', created_at: new Date().toISOString(), by: 'ana' },
    { version: 1, title: null, description: null, format: 'markup', created_at: new Date().toISOString(), by: null },
  ];
  const view = render(() => <VersionHistory versions={versions} currentVersion={3} previewing={null} onPreview={preview} onRestore={() => {}} onBackToCurrent={() => {}} onClose={() => {}} busy={false} embedded />);
  const list = view.getByRole('list', { name: 'Versions' });
  expect(list.querySelectorAll(':scope > li')).toHaveLength(3);
  expect(view.getByRole('button', { name: 'Show the current version' })).toHaveAttribute('aria-pressed', 'true');
  expect(view.getByRole('button', { name: 'Preview version 2' })).toHaveAttribute('aria-pressed', 'false');
  expect(view.getByRole('button', { name: 'Preview version 2' })).toHaveTextContent('@ana');
  expect(view.queryByRole('button', { name: /^Restore version/ })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Preview version 1' }));
  expect(preview).toHaveBeenCalledWith(1);
  // No row the reader is not looking at carries an empty restore slot.
  expect(list.querySelectorAll('li > div')).toHaveLength(0);
});

it('draws the restore action beside the selected version, not inside its row button', () => {
  const view = render(() => <VersionHistory versions={[{ version: 2, title: 'Earlier', description: null, format: 'markup', created_at: new Date().toISOString(), by: 'ana' }]}
    currentVersion={3} previewing={2} onPreview={() => {}} onRestore={() => {}} onBackToCurrent={() => {}} onClose={() => {}} busy={false} embedded />);
  const row = view.getByRole('button', { name: 'Preview version 2' });
  expect(row).toHaveAttribute('aria-pressed', 'true');
  expect(row.contains(view.getByRole('button', { name: 'Restore version 2' }))).toBe(false);
});
