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
  it('places the asset and trash shortcuts side by side under Create', () => {
    render(<WorkspaceCreate onCreated={() => {}} />);
    const shortcuts = screen.getByRole('navigation', { name: 'Workspace shortcuts' });
    expect(shortcuts).toHaveClass('grid-cols-2');
    expect(screen.getByLabelText('Assets')).toHaveAttribute('href', '/assets');
    expect(screen.getByLabelText('Assets').querySelector('svg')).toBeTruthy();
    expect(screen.getByLabelText('Trash')).toHaveAttribute('href', '/trash');
    expect(screen.getByLabelText('Trash').querySelector('svg')).toBeTruthy();
  });

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

  it('creates a folder inside the current folder when the shared workspace is nested', async () => {
    render(<WorkspaceCreate parentId="fold01" onCreated={() => {}} />);
    fireEvent.click(screen.getByLabelText('Create'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New folder' }));
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Q4' } });
    fireEvent.click(screen.getByRole('button', { name: 'create folder' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/my/artifacts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ format: 'folder', title: 'Q4', parent_id: 'fold01' }),
    })));
  });
});
