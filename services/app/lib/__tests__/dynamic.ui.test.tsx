/**
 * The dynamic shim keeps `next/dynamic`'s `ssr: false` semantics: on the
 * SERVER it renders the fallback and never suspends — a boundary the server
 * cannot resolve is React #419, which discards the whole tree and re-renders
 * the root — and in the browser it swaps in the real component after mount.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import dynamic from '@/lib/dynamic';

const Late = dynamic(async () => ({ default: () => <p>the real pane</p> }), { loading: () => <p>loading…</p> });

describe('dynamic()', () => {
  it('renders the fallback on the server, without suspending', () => {
    const html = renderToString(<Late />);
    expect(html).toContain('loading…');
    expect(html).not.toContain('the real pane');
  });

  it('swaps in the component in the browser', async () => {
    render(<Late />);
    await waitFor(() => expect(screen.getByText('the real pane')).toBeTruthy());
  });
});
