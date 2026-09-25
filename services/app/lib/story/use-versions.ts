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
import type {DocumentGraph} from '@artifactbin/contracts';
import {prepareBrowserDocumentUpdate} from './document-authoring-client';

/** A row of history: what changed and when, without the content. */
export interface ArtifactVersionSummary {
  version: number;
  title: string | null;
  description: string | null;
  format: string;
  /** The handle of who made this state, or null (a token, an unnamed account, an older row). */
  by: string | null;
  created_at: string;
}

/** One archived version, with everything needed to RENDER it. */
export interface ArtifactVersionSnapshot {
  version: number;
  html: string;
  title?:string|null;description?:string|null;
  markup: string | null;
  meta: {
    template?:string|null;
    theme?: string | null;
    colorMode?: 'light' | 'dark' | null;
    compiledCss?: string | null;
  };
}

interface UseArtifactVersions {
  versions: ArtifactVersionSummary[];
  /** A restore is in flight; callers disable their controls with this. */
  busy: boolean;
  refresh: () => Promise<void>;
  fetchVersion: (version: number) => Promise<ArtifactVersionSnapshot | null>;
  /** Returns the NEW version number the restore produced, or null on failure. */
  restore: (version: number) => Promise<number | null>;
}

export function useArtifactVersions({ id, currentVersion }: {
  id: string;
  /**
   * The live version. History is re-read whenever it moves, so the list cannot
   * go stale behind a continuously-saving editor.
   */
  currentVersion: number;
}): UseArtifactVersions {
  const [versions, setVersions] = useState<ArtifactVersionSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const base = `/api/my/artifacts/${id}`;
  const refresh = useCallback(async () => {
    const res = await fetch(`${base}/versions`);
    if (!res.ok) return; // not ours, or not yet authorized: keep what we have
    setVersions(((await res.json()) as { versions: ArtifactVersionSummary[] }).versions);
  }, [base]);

  useEffect(() => { void refresh(); }, [refresh, currentVersion]);

  const fetchVersion = useCallback(async (version: number) => {
    const res = await fetch(`${base}/versions/${version}`);
    if (!res.ok) return null;
    return (await res.json()) as ArtifactVersionSnapshot;
  }, [base]);

  const restore = useCallback(async (version: number) => {
    setBusy(true);
    try {
      const observed=await fetch(base);if(!observed.ok)return null;
      const head=await observed.json() as {document:DocumentGraph;version:number;edit_id:string;title:string|null;description:string|null;theme:string|null;template:string|null;colorMode:'light'|'dark'|null};
      const target=await fetchVersion(version);if(!target?.markup||head.document?.kind!=='graph')return null;
      const documentUpdate=await prepareBrowserDocumentUpdate(id,{...head,meta:head},{source:target.markup,whole:true,metadata:{title:target.title??null,description:target.description??null,theme:target.meta.theme??null,template:target.meta.template??null,colorMode:target.meta.colorMode??null}});
      const res = await fetch(`${base}/edits`, {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({edit_id:head.edit_id,document_update:documentUpdate}),
      });
      if (!res.ok) return null;
      return ((await res.json()) as { version: number }).version;
    } finally {
      setBusy(false);
    }
  }, [base,fetchVersion]);

  return { versions, busy, refresh, fetchVersion, restore };
}
