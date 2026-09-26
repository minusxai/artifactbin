import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReferencedFiles } from '../ReferencedFiles';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const source = '<Helmet><Query name="rows" source="ref:ds1234">{`select * from public.rows`}</Query></Helmet><img src="ref:im1234" /><img src="ref:im1234" />';
const references = [{ id: 'ds1234', kind: 'dataset', title: 'Sales' }, { id: 'im1234', kind: 'image', title: 'Logo' }];

describe('referenced files', () => {
  it('lists unique current references and previews the selected image', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ role: 'viewer', surface: { id: 'im1234', format: 'image', title: 'Logo', version: 2 } }))));
    const { rerender } = render(<ReferencedFiles source={source} references={references} />);
    expect(screen.getAllByRole('button', { name: 'View Logo' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'View Logo' }));
    expect(await screen.findByRole('img', { name: 'Logo' })).toHaveAttribute('src', '/a/im1234/raw?v=2');
    expect(fetch).toHaveBeenCalledWith('/api/page/artifact/im1234', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    rerender(<ReferencedFiles source="<p>No files</p>" references={references} />);
    expect(screen.getByText('No referenced files.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('keeps unreadable files in the list but reveals no preview or settings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    render(<ReferencedFiles source={source} references={references} />);
    fireEvent.click(screen.getByRole('button', { name: 'View Logo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This file is unavailable or you do not have access.');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByLabelText('Copy link')).toBeNull();
  });

  it('filters data references and respects the selected dataset permissions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ role: 'viewer', surface: { id: 'ds1234', format: 'dataset', title: 'Sales', version: 1, columns: [{ name: 'amount', type: 'number' }], content: '[{"amount":42}]' } }))));
    render(<ReferencedFiles source={source} references={references} datasetsOnly />);
    expect(screen.queryByRole('button', { name: 'View Logo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View Sales' }));
    await waitFor(() => expect(screen.getByText('42')).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'Configure dataset' })).toBeNull();
    expect(screen.queryByLabelText('Copy link')).toBeNull();
  });

  it('offers dataset actions to its editor inside the data view', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith('/sharing') ? { visibility: 'private', shares: [], linkRole: 'viewer', canPrivate: true, policyVersion: 2 }
        : { role: 'editor', surface: { id: 'ds1234', format: 'dataset', title: 'Sales', version: 1, columns: [], content: '[]' } }
    ))));
    render(<ReferencedFiles source={source} references={references} datasetsOnly />);
    fireEvent.click(screen.getByRole('button', { name: 'View Sales' }));
    expect(await screen.findByRole('link', { name: 'Configure dataset' })).toHaveAttribute('href', '/a/ds1234/edit');
    expect(await screen.findByLabelText('Copy link')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage access policies' })).toBeTruthy();
  });
});
