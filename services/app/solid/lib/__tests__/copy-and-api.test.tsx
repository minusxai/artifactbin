import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../copy-text';
import { ApiError, apiRequest } from '../api';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('copyText', () => {
  it('uses the async clipboard when present', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('hi')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hi');
  });
  it('falls back to execCommand when the clipboard rejects, and reports false when that fails too', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    document.execCommand = vi.fn().mockReturnValue(true);
    expect(await copyText('hi')).toBe(true);
    document.execCommand = vi.fn().mockReturnValue(false);
    expect(await copyText('hi')).toBe(false);
  });
});

describe('apiRequest', () => {
  it('sends same-origin JSON and returns the parsed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'a' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await apiRequest<{ id: string }>('/api/x', 'POST', { a: 1 })).toEqual({ id: 'a' });
    expect(fetchMock).toHaveBeenCalledWith('/api/x', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
  });
  it('throws an ApiError carrying the server explanation and status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'nope', details: ['bad field'] }), { status: 422 })));
    await expect(apiRequest('/api/x', 'PUT', {})).rejects.toMatchObject({ message: 'bad field', status: 422 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const error = await apiRequest("/api/x").catch((e: unknown) => e) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('The request failed.');
  });
});
