import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppBar } from '../PageChrome';
import { InlineReaderChrome } from '../InlineReaderChrome';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('GitHub count in actual chrome', () => {
  it('loads the count in app and reader chrome from the same public endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ count: 1234 })));
    vi.stubGlobal('fetch', fetch);
    const { container } = render(<MemoryRouter><AppBar /><InlineReaderChrome input={{ artifactId: null, title: null, author: null }} onAction={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByRole('link', { name: /1,234 stars/ })).toHaveLength(3));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/github-stars');
    const rail = container.querySelector('[data-mx-reader-rail]')!;
    expect(rail.firstElementChild?.getAttribute('data-mx-github-star')).toBe('');
    expect(rail.children[1].getAttribute('data-mx-reader-action')).toBe('like');
    expect(rail.children[2].getAttribute('data-mx-reader-action')).toBe('comment');
    expect(container.querySelector('header [data-mx-github-star]')).not.toBeNull();
  });
});
