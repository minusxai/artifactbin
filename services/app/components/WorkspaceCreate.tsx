'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, FilePlus2, FolderPlus, Plus, X } from 'lucide-react';
import GetStarted from '@/components/GetStarted';

type CreateKind = 'artifact' | 'folder';

function CreateDialog({
  kind,
  onClose,
  onCreated,
}: {
  kind: CreateKind;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !panel.current) return;
      const stops = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const createFolder = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    setError('');
    const response = await fetch('/api/my/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'folder', title, parent_id: null }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError('Could not create the folder. Try again.');
      return;
    }
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
            <p className="mt-1 font-sans text-xs text-muted">
              {artifact ? 'Connect an agent, then tell it what you want to make.' : 'Folders keep related artifacts and data files together.'}
            </p>
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

/** The homepage's single creation door: choice first, details second. */
export default function WorkspaceCreate({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<CreateKind | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const choose = (kind: CreateKind) => {
    setOpen(false);
    setDialog(kind);
  };

  return (
    <div ref={root} className="relative z-30 mb-5 border-b border-edge pb-5">
      <button
        type="button"
        aria-label="Create"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="group flex h-9 w-full cursor-pointer items-center rounded-[5px] border border-accent bg-accent px-3 font-mono text-xs font-semibold text-bg transition-[filter] hover:brightness-105"
      >
        <Plus aria-hidden="true" size={15} strokeWidth={2} />
        <span className="ml-2">Create</span>
        <ChevronDown aria-hidden="true" size={14} className={`ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="menu" aria-label="Create menu" className="absolute inset-x-0 top-[calc(100%-1.15rem)] overflow-hidden rounded-[6px] border border-edge-bright bg-surface p-1 shadow-xl">
          <button
            type="button"
            role="menuitem"
            onClick={() => choose('artifact')}
            className="flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2.5 py-2 text-left font-mono text-[11px] text-fg transition-colors hover:bg-accent-soft hover:text-accent"
          >
            <FilePlus2 aria-hidden="true" size={14} />
            New artifact
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => choose('folder')}
            className="flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2.5 py-2 text-left font-mono text-[11px] text-fg transition-colors hover:bg-accent-soft hover:text-accent"
          >
            <FolderPlus aria-hidden="true" size={14} />
            New folder
          </button>
        </div>
      )}

      {dialog && <CreateDialog kind={dialog} onClose={() => setDialog(null)} onCreated={onCreated} />}
    </div>
  );
}
