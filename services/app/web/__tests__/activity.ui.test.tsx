/**
 * THE DASHBOARD'S ACTIVITY SECTION: one line per row — who, the verb in plain
 * words, the document as a link, when — two lists, and nothing at all when
 * there is nothing to say.
 *
 * Seeded RED by the orchestrator.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { ActivityFeed } from '@/components/ActivityFeed';
import type { FeedItem } from '@/lib/feed-wire';

afterEach(cleanup);

const item = (over: Partial<FeedItem> & { id: string; verb: string }): FeedItem => ({
  at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  subject: { kind: 'user', id: 'usr_b', handle: 'bob' },
  object: { kind: 'artifact', id: 'art0a1', title: 'Quarterly numbers' },
  payload: {},
  ...over,
});

describe('ActivityFeed', () => {
  it('renders nothing when both lists are empty', () => {
    const { container } = render(<MemoryRouter><ActivityFeed mine={[]} following={[]} /></MemoryRouter>);
    expect(container.innerHTML).toBe('');
  });
  it('reads each row as a sentence: handle, plain verb, the title as a link, a relative time', () => {
    render(<MemoryRouter><ActivityFeed
      mine={[
        item({ id: 'e1', verb: 'liked' }),
        item({ id: 'e2', verb: 'viewed', subject: { kind: 'visitor', id: 'v'.repeat(32), handle: null } }),
        item({ id: 'e3', verb: 'annotated', payload: { annotation_id: 'ann_1' } }),
      ]}
      following={[item({ id: 'e4', verb: 'created', subject: { kind: 'user', id: 'usr_a', handle: 'alice' }, object: { kind: 'artifact', id: 'art0a2', title: 'Roadmap' } })]}
    /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /activity/i })).toBeTruthy();
    expect(screen.getByText(/on your artifacts/i)).toBeTruthy();
    expect(screen.getByText(/from people you follow/i)).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]!.textContent).toMatch(/@bob\s+liked\s+Quarterly numbers/);
    expect(rows[1]!.textContent).toMatch(/someone\s+viewed\s+Quarterly numbers/i);
    expect(rows[2]!.textContent).toMatch(/@bob\s+commented on\s+Quarterly numbers/);
    expect(rows[3]!.textContent).toMatch(/@alice\s+published\s+Roadmap/);
    expect(rows[0]!.textContent).toMatch(/2 ?h(ours)? ago|2h/);
    const links = screen.getAllByRole('link', { name: 'Quarterly numbers' });
    expect(links[0]!.getAttribute('href')).toBe('/a/art0a1');
    expect(screen.getByRole('link', { name: 'Roadmap' }).getAttribute('href')).toBe('/a/art0a2');
  });
  it('a document with no title is still a link, by its id', () => {
    render(<MemoryRouter><ActivityFeed mine={[item({ id: 'e1', verb: 'forked', object: { kind: 'artifact', id: 'art0a9', title: null } })]} following={[]} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'art0a9' }).getAttribute('href')).toBe('/a/art0a9');
    expect(screen.getByRole('listitem').textContent).toMatch(/forked/);
  });
});
