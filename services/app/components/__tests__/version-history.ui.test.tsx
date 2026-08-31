/**
 * The version-history drawer names WHO made a version when the row knows —
 * a collaborator's edits are the reason history can say so at all — and
 * says nothing (never an email, never a placeholder) when it does not.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import VersionHistory from '../VersionHistory';

const version = (n: number, by: string | null) => ({ version: n, title: null, description: null, format: 'markup', by, created_at: '2026-08-01T00:00:00.000Z' });

describe('VersionHistory', () => {
  it('shows the author handle on attributed rows and nothing on the rest', () => {
    render(
      <VersionHistory
        versions={[version(2, 'bob'), version(1, null)]}
        currentVersion={3}
        previewing={null}
        onPreview={vi.fn()}
        onRestore={vi.fn()}
        onBackToCurrent={vi.fn()}
        onClose={vi.fn()}
        busy={false}
      />,
    );
    expect(screen.getByLabelText('Version 2 by bob')).toHaveTextContent('@bob');
    expect(screen.queryByLabelText(/Version 1 by/)).toBeNull();
    expect(screen.getByLabelText('Preview version 1')).not.toHaveTextContent('@');
  });
});
