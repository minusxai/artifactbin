import { createEffect } from 'solid-js';
import { usePageData } from '../lib/use-page-data';

export interface DocumentChromeDetails {
  author: { username: string | null; id?: string | null; image?: string | null; forkedFrom?: { label: string; href: string | null } | null } | null;
  like: { liked: boolean; count: number };
  follow: { userId: string; following: boolean; count: number } | null;
  openAnnotations: number;
  hasInvitedUsers?: boolean;
}

/** Begin reading decorations once the shell has adopted the server-drawn frame. */
export function bindDocumentChrome(id: string, update: (details: DocumentChromeDetails | null) => void): void {
  const chrome = usePageData<DocumentChromeDetails>(`/api/page/artifact/${encodeURIComponent(id)}?part=chrome`);
  createEffect(() => update(chrome.data()));
}
