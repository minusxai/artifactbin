import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ActivityFeed from '@/components/ActivityFeed';
import Dashboard from '@/components/Dashboard';
import WorkspaceCreate from '@/components/WorkspaceCreate';

const openings = [
  {
    name: 'expanded activity',
    open() {
      render(<ActivityFeed following={[]} mine={[{
        id: 'event1', at: '2026-09-01T00:00:00Z', verb: 'viewed',
        subject: { kind: 'visitor', id: 'visitor1', handle: null },
        object: { kind: 'artifact', id: 'doc001', title: 'Report' }, payload: {},
      }]} />);
      fireEvent.click(screen.getByLabelText('Expand activity'));
    },
  },
  {
    name: 'expanded dashboard',
    open() {
      render(<Dashboard rows={[]} viewsOverTime={[]} />);
      fireEvent.click(screen.getByLabelText('Expand dashboard'));
    },
  },
  {
    name: 'folder creation',
    open() {
      render(<WorkspaceCreate onCreated={() => {}} />);
      fireEvent.click(screen.getByLabelText('Create'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'New folder' }));
      fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Research' } });
    },
  },
];

afterEach(() => { cleanup(); document.body.style.overflow = ''; });

describe.each(openings)('$name keyboard lifecycle', ({ open }) => {
  it('wraps keyboard focus in both directions and restores scrolling on Escape', () => {
    document.body.style.overflow = 'scroll';
    open();
    const dialog = screen.getByRole('dialog');
    const stops = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])')];
    expect(stops.length).toBeGreaterThan(0);
    const first = stops[0], last = stops[stops.length - 1];
    first.focus();
    expect(fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(last);
    expect(fireEvent.keyDown(window, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(first);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('restores scrolling when its owner unmounts', () => {
    document.body.style.overflow = 'auto';
    open();
    cleanup();
    expect(document.body.style.overflow).toBe('auto');
  });
});
