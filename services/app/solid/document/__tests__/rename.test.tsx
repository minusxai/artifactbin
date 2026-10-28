/* @jsxImportSource solid-js */
import { expect, it, vi } from 'vitest';
import { fireEvent, render } from '../../__tests__/helpers';
import { writeBrowserArtifact } from '@/lib/artifact-backend/browser-artifact-write';
import { waitFor, screen } from '@testing-library/dom';
import { RenameDocument } from '../RenameDocument';
vi.mock('@/lib/artifact-backend/browser-artifact-write', () => ({ writeBrowserArtifact: vi.fn() }));

it('saves only title metadata and reports the accepted name', async () => {
  vi.mocked(writeBrowserArtifact).mockResolvedValue(Response.json({}));
  const renamed = vi.fn();
  const view = render(() => <RenameDocument id="doc12345" title="Before" onRenamed={renamed} />);
  fireEvent.click(view.getByRole('button', { name: 'Rename artifact' }));
  fireEvent.input(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'After' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save title' }));
  await waitFor(() => expect(renamed).toHaveBeenCalledWith('After'));
  expect(writeBrowserArtifact).toHaveBeenCalledWith('doc12345', { title: 'After' });
  expect(screen.queryByRole('dialog', { name: 'Rename artifact' })).toBeNull();
});

it('keeps a refused rename available for correction', async () => {
  vi.mocked(writeBrowserArtifact).mockResolvedValue(Response.json({}, { status: 409 }));
  const renamed = vi.fn();
  const view = render(() => <RenameDocument id="doc12345" title="Before" onRenamed={renamed} />);
  fireEvent.click(view.getByRole('button', { name: 'Rename artifact' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save title' }));
  await screen.findByText('Could not rename this artifact. Refresh and try again.');
  expect(renamed).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Before');
});
