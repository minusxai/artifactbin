/** P2 (seeded RED) — the move picker: a tree from ancestor_ids, the moved folder's subtree disabled, one PATCH body. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderPicker } from '@/components/FolderPicker';

afterEach(cleanup);
const folders = [
  { id: 'rep001', title: 'Reports', ancestor_ids: [] },
  { id: 'y26001', title: '2026', ancestor_ids: ['rep001'] },
  { id: 'q30001', title: 'Q3', ancestor_ids: ['rep001', 'y26001'] },
  { id: 'dec001', title: 'Decks', ancestor_ids: [] },
];

describe('FolderPicker', () => {
  it('lists root then every folder, indented by depth, with the current location marked', () => {
    render(<FolderPicker folders={folders} moving={{ id: 'doc001', format: 'markup', ancestor_ids: ['rep001', 'y26001'] }} current="y26001" onMove={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText('Move to root')).toBeTruthy();
    expect(screen.getByLabelText('Move to Q3').getAttribute('data-depth')).toBe('2');
    expect(screen.getByLabelText('Move to Reports').getAttribute('data-depth')).toBe('0');
    expect(screen.getByLabelText('Move to 2026').getAttribute('aria-current')).toBe('location');
    expect(screen.getByLabelText('Move to Decks').getAttribute('aria-current')).toBeNull();
  });

  it('disables the moved folder itself and everything under it', () => {
    render(<FolderPicker folders={folders} moving={{ id: 'rep001', format: 'folder', ancestor_ids: [] }} current={null} onMove={() => {}} onClose={() => {}} />);
    for (const t of ['Reports', '2026', 'Q3']) expect((screen.getByLabelText(`Move to ${t}`) as HTMLButtonElement).disabled, t).toBe(true);
    expect((screen.getByLabelText('Move to Decks') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText('Move to root') as HTMLButtonElement).disabled).toBe(false);
  });

  it('filters by name and reports the chosen parent id, or null for root', () => {
    const onMove = vi.fn();
    render(<FolderPicker folders={folders} moving={{ id: 'doc001', format: 'markup', ancestor_ids: [] }} current={null} onMove={onMove} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Filter folders'), { target: { value: 'dec' } });
    expect(screen.queryByLabelText('Move to Q3')).toBeNull();
    fireEvent.click(screen.getByLabelText('Move to Decks'));
    expect(onMove).toHaveBeenCalledWith('dec001');
    fireEvent.change(screen.getByLabelText('Filter folders'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Move to root'));
    expect(onMove).toHaveBeenCalledWith(null);
  });
});
