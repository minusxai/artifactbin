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
