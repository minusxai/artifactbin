import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Shelf, { type ShelfRow } from '@/components/Shelf';

afterEach(() => { cleanup(); localStorage.clear(); });
describe('workspace navigation stays in the current tab', () => {
  for (const actions of ['full', 'share'] as const) {
    for (const view of ['Grid view', 'List view']) {
      it(`${actions} shelf ${view} keeps artifact and folder links local`, () => {
        const rows: ShelfRow[] = [
          { id: 'doc123', url: '/a/doc123', title: 'Document', format: 'markup', version: 1, updated_at: '2026-09-09T00:00:00Z' },
          { id: 'folder123', url: '/a/folder123', title: 'Folder', format: 'folder', version: 1, updated_at: '2026-09-09T00:00:00Z' },
        ];
        render(<Shelf rows={rows} actions={actions} scopeParentId={null} />);
        fireEvent.click(screen.getByLabelText(view));
        for (const label of ['Open Document', 'Open folder Folder']) {
          expect(screen.getByLabelText(label)).not.toHaveAttribute('target', '_blank');
        }
      });
    }
  }
});
