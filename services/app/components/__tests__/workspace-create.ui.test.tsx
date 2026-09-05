import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceCreate from '@/components/WorkspaceCreate';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'folder-1' }), { status: 201 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkspaceCreate', () => {
  it('opens Getting Started for a new artifact', () => {
    render(<WorkspaceCreate onCreated={() => {}} />);
    fireEvent.click(screen.getByLabelText('Create'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New artifact' }));

    expect(screen.getByRole('dialog', { name: 'Create new artifact' })).toBeInTheDocument();
    expect(screen.getByLabelText('Get started')).toBeInTheDocument();
    expect(screen.getByLabelText('Create a live document for my agent')).toBeInTheDocument();
  });

  it('creates a named root folder and refreshes the home data', async () => {
    const onCreated = vi.fn();
    render(<WorkspaceCreate onCreated={onCreated} />);
    fireEvent.click(screen.getByLabelText('Create'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New folder' }));

    const dialog = screen.getByRole('dialog', { name: 'Create new folder' });
    const submit = screen.getByRole('button', { name: 'create folder' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Research' } });
    fireEvent.click(submit);

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith('/api/my/artifacts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ format: 'folder', title: 'Research', parent_id: null }),
    }));
    expect(dialog).not.toBeInTheDocument();
  });
});
