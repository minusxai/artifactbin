'use client';

/**
 * THE ONE CREATE DIALOG. Every "new artifact" gesture on the site opens THIS —
 * the workspace's Create menu and the landing footer alike — so there is one
 * place that says how an artifact comes to exist: install afbin, copy the
 * instructions, paste them into an agent (GetStarted). Folders are the other
 * kind, a plain named form. Portaled to <body>, so it floats above whichever
 * page opened it.
 */
import { useDialogKeyboard } from './use-dialog-keyboard';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FilePlus2, FolderPlus, X } from 'lucide-react';
import GetStarted from '@/components/GetStarted';
import { pageDataChanged } from '@/web/page-data-events';

export type CreateKind = 'artifact' | 'folder';

export default function CreateDialog({
  kind,
  parentId,
  onClose,
  onCreated,
}: {
  kind: CreateKind;
  parentId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);

  useDialogKeyboard(panel, onClose, 'button:not([disabled]), input:not([disabled])');

  const createFolder = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    setError('');
    const response = await fetch('/api/my/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'folder', title, parent_id: parentId }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError('Could not create the folder. Try again.');
      return;
    }
    pageDataChanged();
    onClose();
    onCreated();
  };

  const artifact = kind === 'artifact';
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-8">
      <button
        type="button"
        aria-label="Close create dialog by clicking outside"
        onClick={onClose}
        className="absolute inset-0 cursor-default border-0 bg-black/45 p-0 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={artifact ? 'Create new artifact' : 'Create new folder'}
        className={`relative z-10 flex max-h-[calc(100svh-24px)] w-full flex-col overflow-hidden rounded-[9px] border border-edge-bright bg-surface shadow-2xl ${artifact ? 'max-w-3xl' : 'max-w-md'}`}
      >
        <header className="flex items-start gap-4 border-b border-edge px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-mono text-sm font-semibold text-fg">
              {artifact ? <FilePlus2 aria-hidden="true" size={15} className="text-accent" /> : <FolderPlus aria-hidden="true" size={15} className="text-accent" />}
              {artifact ? 'New artifact' : 'New folder'}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close create dialog"
            autoFocus={artifact}
            onClick={onClose}
            className="ml-auto inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-muted transition-colors hover:bg-raised hover:text-fg"
          >
            <X size={15} />
          </button>
        </header>

        {artifact ? (
          <div className="overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            {parentId && (
              <p className="mb-4 rounded-[5px] border border-edge bg-raised px-3 py-2 font-mono text-[10px] text-muted">
                create inside this folder with <code className="text-fg">parent_id: &quot;{parentId}&quot;</code>
              </p>
            )}
            <GetStarted heading={false} frame={false} />
          </div>
        ) : (
          <form onSubmit={createFolder} className="px-4 py-5 sm:px-6">
            <label htmlFor="workspace-folder-name" className="block font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
              Folder name
            </label>
            <input
              id="workspace-folder-name"
              autoFocus
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Research"
              className="mt-2 h-9 w-full rounded-[5px] border border-edge bg-bg px-3 font-mono text-xs text-fg placeholder:text-faint focus:border-accent focus:outline-none"
            />
            {error && <p role="alert" className="mt-2 font-mono text-[10px] text-danger">{error}</p>}
            <div className="mt-5 flex justify-end gap-2 border-t border-edge pt-4">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-[5px] border border-edge bg-transparent px-3 py-1.5 font-mono text-[11px] text-muted transition-colors hover:border-edge-bright hover:text-fg"
              >
                cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || busy}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-[5px] border border-accent bg-accent px-3 py-1.5 font-mono text-[11px] text-bg transition-opacity disabled:cursor-default disabled:opacity-40"
              >
                <FolderPlus aria-hidden="true" size={13} />
                {busy ? 'creating…' : 'create folder'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
