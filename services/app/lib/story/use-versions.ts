'use client';

/**
 * Version history as ONE capability: list, read one, restore.
 *
 * One endpoint family (`/api/my/...`) for every browser caller: an account
 * session and an anonymous browser's agent-session cookie both authorize it,
 * each in its own scope (lib/agent-session) — there is no per-caller endpoint
 * choice.
 *
 * Read-only by nature except for `restore`, which submits a prepared whole-document JSONB update —
 * and a revert creates a NEW version server-side, so restoring is itself
 * undoable and nothing is ever lost by trying one.
 */
import { useCallback, useEffect, useState } from 'react';
import {restoreBrowserArtifact} from '../browser-artifact-write';
import type { ArtifactBackend, ArtifactVersionSnapshot, ArtifactVersionSummary } from '@/lib/artifact-backend/types';

export type { ArtifactVersionSnapshot, ArtifactVersionSummary };

interface UseArtifactVersions {
  versions: ArtifactVersionSummary[];
  /** A restore is in flight; callers disable their controls with this. */
  busy: boolean;
  refresh: () => Promise<void>;
  fetchVersion: (version: number) => Promise<ArtifactVersionSnapshot | null>;
  /** Returns the NEW version number the restore produced, or null on failure. */
  restore: (version: number) => Promise<number | null>;
}

export function useArtifactVersions({ backend, currentVersion }: {
  backend: ArtifactBackend;
  /**
   * The live version. History is re-read whenever it moves, so the list cannot
   * go stale behind a continuously-saving editor.
   */
  currentVersion: number;
}): UseArtifactVersions {
  const [versions, setVersions] = useState<ArtifactVersionSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    // A backend without history (the offline file) has nothing to list.
    if (backend.unavailable('versions')) return;
    const rows = await backend.versions();
    if (!rows) return; // not ours, or not yet authorized: keep what we have
    setVersions(rows);
  }, [backend]);

  useEffect(() => { void refresh(); }, [refresh, currentVersion]);

  const fetchVersion = useCallback((version: number) => backend.version(version), [backend]);

  const restore = useCallback(async (version: number) => {
    setBusy(true);
    try {
      return await restoreBrowserArtifact(backend, version);
    } finally {
      setBusy(false);
    }
  }, [backend]);

  return { versions, busy, refresh, fetchVersion, restore };
}
