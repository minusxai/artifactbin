/**
 * The "shared with you" section of the dashboard: pure presentation of
 * `listSharedWithEmail` rows. Its contract:
 *  - nothing shared → NO chrome at all (an empty section reads as a bug),
 *  - each row links to the universal short URL (/a/<id> — the recipient is
 *    not the owner, so pretty owner-URLs are decoration they may not have),
 *  - the owner's handle says who shared it; a handle-less owner still rows.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SharedWithYou from '../SharedWithYou';
import type { SharedArtifactSummary } from '@/lib/users';

const row = (id: string, over: Partial<SharedArtifactSummary> = {}): SharedArtifactSummary => ({
  id,
  title: `doc ${id}`,
  description: null,
  format: 'markup',
  role: 'viewer',
  meta: {},
  version: 1,
  access: 'read',
  visibility: 'private',
  edit_id: 'e'.repeat(32),
  folder: '',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  owner_username: 'alice',
  ...over,
});

describe('SharedWithYou', () => {
  it('renders nothing when nothing is shared', () => {
    const { container } = render(<SharedWithYou items={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('tells the recipient what they may DO with each document', () => {
    render(<SharedWithYou items={[row('abc123'), row('def456', { role: 'editor' }), row('ghi789', { role: 'commenter' })]} />);
    expect(screen.getByLabelText('Your role on abc123')).toHaveTextContent('can view');
    expect(screen.getByLabelText('Your role on def456')).toHaveTextContent('can edit');
    expect(screen.getByLabelText('Your role on ghi789')).toHaveTextContent('can comment');
  });

  it('searches shared work and filters it by access level', () => {
    render(<SharedWithYou items={[row('abc123'), row('def456', { role: 'editor' })]} />);
    const search = screen.getByLabelText('Search shared artifacts');

    fireEvent.change(search, { target: { value: 'def456' } });
    expect(screen.queryByLabelText('Open shared artifact abc123')).toBeNull();
    expect(screen.getByLabelText('Open shared artifact def456')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Filter editor'));
    expect(screen.queryByLabelText('Open shared artifact abc123')).toBeNull();
    expect(screen.getByLabelText('Open shared artifact def456')).toBeInTheDocument();
  });

  it('lists each shared document as a link to /a/<id>, naming the owner', () => {
    render(<SharedWithYou items={[row('abc123'), row('def456', { owner_username: null, title: null })]} />);
    const section = screen.getByLabelText('Shared with you');
    expect(section).toBeTruthy();
    const link = screen.getByLabelText('Open shared artifact abc123') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/a/abc123');
    expect(link.textContent).toContain('doc abc123');
    // Who shared it.
    expect(section.textContent).toContain('@alice');
    // A handle-less owner and an untitled doc still make a usable row.
    const bare = screen.getByLabelText('Open shared artifact def456') as HTMLAnchorElement;
    expect(bare.getAttribute('href')).toBe('/a/def456');
  });
});
