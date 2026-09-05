/**
 * THE DASHBOARD'S ACTIVITY SECTION: one line per row — who, the verb in plain
 * words, the document as a link, when — two lists, and nothing at all when
 * there is nothing to say.
 *
 * Seeded RED by the orchestrator.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  it('does not show export delivery events as activity', () => {
    const { container } = render(<MemoryRouter><ActivityFeed mine={[item({ id: 'e-export', verb: 'exported' })]} following={[]} /></MemoryRouter>);
    expect(container.innerHTML).toBe('');
  });
  it('reads each row as a sentence: handle, plain verb, the title as a link, a relative time', () => {
    const at = Date.now() - 2 * 3_600_000;
    render(<MemoryRouter><ActivityFeed
      mine={[
        item({ id: 'e1', verb: 'liked', at: new Date(at).toISOString() }),
        item({ id: 'e2', verb: 'viewed', at: new Date(at - 1_000).toISOString(), subject: { kind: 'visitor', id: 'v'.repeat(32), handle: null } }),
        item({ id: 'e3', verb: 'annotated', at: new Date(at - 2_000).toISOString(), payload: { annotation_id: 'ann_1' } }),
      ]}
      following={[item({ id: 'e4', verb: 'created', at: new Date(at - 3_000).toISOString(), subject: { kind: 'user', id: 'usr_a', handle: 'alice' }, object: { kind: 'artifact', id: 'art0a2', title: 'Roadmap' } })]}
    /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /activity/i })).toBeTruthy();
    expect(screen.queryByText(/on your artifacts/i)).toBeNull();
    expect(screen.getByText(/from people you follow/i)).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]!.textContent).toMatch(/@bob\s+liked\s+Quarterly numbers/);
    expect(rows[1]!.textContent).toMatch(/someone\s+viewed\s+Quarterly numbers/i);
    expect(rows[2]!.textContent).toMatch(/@bob\s+commented on\s+Quarterly numbers/);
    expect(rows[3]!.textContent).toMatch(/@alice\s+published\s+Roadmap/);
    expect(rows[0]!.textContent).toMatch(/2 ?h(ours)? ago|2h/);
    expect(rows[0]!.firstElementChild).toHaveClass('truncate', 'whitespace-nowrap');
    const links = screen.getAllByRole('link', { name: 'Quarterly numbers' });
    expect(links[0]!.getAttribute('href')).toBe('/a/art0a1');
    expect(screen.getByRole('link', { name: 'Roadmap' }).getAttribute('href')).toBe('/a/art0a2');
  });
  it('a document with no title is still a link, by its id', () => {
    render(<MemoryRouter><ActivityFeed mine={[item({ id: 'e1', verb: 'forked', object: { kind: 'artifact', id: 'art0a9', title: null } })]} following={[]} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'art0a9' }).getAttribute('href')).toBe('/a/art0a9');
    expect(screen.getByRole('listitem').textContent).toMatch(/forked/);
  });
  it('stacks both activity groups in the narrow dashboard rail', () => {
    render(<MemoryRouter><ActivityFeed compact mine={[item({ id: 'e1', verb: 'liked' })]} following={[item({ id: 'e2', verb: 'created' })]} /></MemoryRouter>);
    expect(screen.getByLabelText('Activity')).toHaveAttribute('data-layout', 'rail');
    expect(screen.getByLabelText('Activity').querySelector('div')).not.toHaveClass('sm:flex-row');
  });
  it('shows the ten newest events across both groups and summarizes the rest', () => {
    const now = Date.now();
    const mine = Array.from({ length: 7 }, (_, index) => item({
      id: `mine-${index}`,
      verb: 'viewed',
      at: new Date(now - index * 60_000).toISOString(),
      object: { kind: 'artifact', id: `mine-artifact-${index}`, title: `Mine ${index}` },
    }));
    const following = Array.from({ length: 5 }, (_, index) => item({
      id: `following-${index}`,
      verb: 'created',
      at: new Date(now - (index + 7) * 60_000).toISOString(),
      object: { kind: 'artifact', id: `following-artifact-${index}`, title: `Following ${index}` },
    }));

    render(<MemoryRouter><ActivityFeed compact mine={mine} following={following} /></MemoryRouter>);

    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText('+ 2 more')).toBeTruthy();
    expect(screen.getByLabelText('2 more activity events')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Following 2' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Following 3' })).toBeNull();

    fireEvent.click(screen.getByLabelText('Expand activity'));
    const dialog = screen.getByRole('dialog', { name: 'Expanded activity' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(12);
    expect(within(dialog).queryByText('+ 2 more')).toBeNull();
    fireEvent.click(within(dialog).getByLabelText('Close expanded activity'));
    expect(screen.queryByRole('dialog', { name: 'Expanded activity' })).toBeNull();
  });
});
