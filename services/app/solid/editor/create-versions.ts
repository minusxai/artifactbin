/**
 * Version
 * history as one capability — list, read one, restore.
 *
 * One endpoint family (`/api/my/...`) for every browser caller: an account
 * session and an anonymous browser's agent-session cookie both authorize it,
 * each in its own scope (lib/agent-session) — there is no per-caller endpoint
 * choice.
 *
 * Read-only by nature except for `restore`, which submits a prepared
 * whole-document JSONB update — and a revert creates a NEW version
 * server-side, so restoring is itself undoable and nothing is ever lost by
 * trying one.
 *
 * `options` is read LIVE, like solid/editor/create-live-edits: pass a Solid
 * component's own `props` object (not a spread copy) and a moving
 * `currentVersion` re-triggers `refresh` with no dependency list to keep in
 * step — the whole point, since an editor keeps saving under this.
 */
import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import { restoreBrowserArtifact } from '@/lib/artifacts/browser-artifact-write';
import type { ArtifactBackend, ArtifactVersionSnapshot, ArtifactVersionSummary } from '@/lib/artifact-backend/types';

export type { ArtifactVersionSnapshot, ArtifactVersionSummary };

export interface ArtifactVersionsOptions {
  backend: ArtifactBackend;
  /** The live version. History is re-read whenever it moves — see the module comment. */
  currentVersion: number;
}

export interface ArtifactVersions {
  versions: Accessor<ArtifactVersionSummary[]>;
  /** A restore is in flight; callers disable their controls with this. */
  busy: Accessor<boolean>;
  refresh(): Promise<void>;
  fetchVersion(version: number): Promise<ArtifactVersionSnapshot | null>;
  /** Returns the NEW version number the restore produced, or null on failure. */
  restore(version: number): Promise<number | null>;
}

export function createArtifactVersions(options: ArtifactVersionsOptions): ArtifactVersions {
  const [versions, setVersions] = createSignal<ArtifactVersionSummary[]>([]);
  const [busy, setBusy] = createSignal(false);

  // One history request at a time: asks that arrive while one is in flight share it and trigger ONE trailing
  // read, so an out-of-order response can never replace a newer list and a burst of saves costs two requests.
  let inflight: Promise<void> | null = null;
  let again = false;
  const refresh = (): Promise<void> => {
    // A backend without history (the offline file) has nothing to list.
    if (options.backend.unavailable('versions')) return Promise.resolve();
    if (inflight) { again = true; return inflight; }
    inflight = (async () => {
      do {
        again = false;
        const rows = await options.backend.versions();
        if (rows && !again) setVersions(rows); // null: not ours, or not yet authorized: keep what we have
      } while (again);
    })().finally(() => { inflight = null; });
    return inflight;
  };

  let first = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    // Tracked reads: a Solid props object makes both live.
    void options.currentVersion;
    void options.backend;
    // The list loads at once; later version moves (saves, collaborators' saves over the live stream) settle briefly first.
    if (first) { first = false; void refresh(); return; }
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 300);
  });
  onCleanup(() => clearTimeout(timer));

  const fetchVersion = (version: number): Promise<ArtifactVersionSnapshot | null> => options.backend.version(version);

  const restore = async (version: number): Promise<number | null> => {
    setBusy(true);
    try {
      return await restoreBrowserArtifact(options.backend, version);
    } finally {
      setBusy(false);
    }
  };

  return { versions, busy, refresh, fetchVersion, restore };
}
