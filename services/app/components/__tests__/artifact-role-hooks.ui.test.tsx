/**
 * THREE ROLES, TWO RIGHTS. `useCanEditArtifact` answers the owner and a named
 * editor; `useCanAnnotateArtifact` answers those two AND a commenter. The
 * first version of the shell derived "can edit" as "not a reader", which
 * handed a commenter the edit button the moment the role existed.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import ArtifactShell, { useCanAnnotateArtifact, useCanEditArtifact } from '@/components/ArtifactShell';
import type { ArtifactRole } from '@/lib/share-roles';

const under = (role: ArtifactRole) => ({ children }: { children: ReactNode }) => <ArtifactShell role={role}>{children}</ArtifactShell>;

describe('role hooks', () => {
  it.each([
    ['owner', true, true],
    ['editor', true, true],
    ['commenter', false, true],
    ['viewer', false, false],
  ] as const)('%s: edit=%s annotate=%s', (role, edit, annotate) => {
    const wrapper = under(role);
    expect(renderHook(() => useCanEditArtifact(), { wrapper }).result.current).toBe(edit);
    expect(renderHook(() => useCanAnnotateArtifact(), { wrapper }).result.current).toBe(annotate);
  });
});
