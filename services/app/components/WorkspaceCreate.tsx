'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Database, FilePlus2, FolderPlus, Plus, Trash2 } from 'lucide-react';
import CreateDialog, { type CreateKind } from '@/components/CreateDialog';

/** The homepage's single creation door: choice first, details second. */
export default function WorkspaceCreate({ onCreated, parentId = null }: { onCreated: () => void; parentId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<CreateKind | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const choose = (kind: CreateKind) => {
    setOpen(false);
    setDialog(kind);
  };

  return (
    <div ref={root} className="relative z-30 lg:border-b lg:border-edge lg:pb-3">
      <div className="relative">
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
          <div role="menu" aria-label="Create menu" className="absolute inset-x-0 top-[calc(100%+0.35rem)] z-40 overflow-hidden rounded-[6px] border border-edge-bright bg-surface p-1 shadow-xl">
            <button
              type="button"
              role="menuitem"
              onClick={() => choose('artifact')}
              className="flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2.5 py-2 text-left font-mono text-[11px] text-fg transition-colors hover:bg-accent-soft hover:text-accent"
            >
              <FilePlus2 aria-hidden="true" size={14} />
              New artifact
            </button>
            <a
              href="/datasets/new"
              role="menuitem"
              aria-label="Create dataset"
              onClick={() => setOpen(false)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2.5 py-2 text-left font-mono text-[11px] text-fg no-underline transition-colors hover:bg-accent-soft hover:text-accent"
            >
              <Database aria-hidden="true" size={14} />
              New dataset
            </a>
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
      </div>

      <nav aria-label="Workspace shortcuts" className="mt-2 grid grid-cols-2 gap-1">
        <a href="/assets" aria-label="Assets" className="flex h-7 items-center justify-center gap-1.5 rounded-[4px] border border-edge bg-raised px-2 font-mono text-[11px] text-muted no-underline transition-colors hover:border-edge-bright hover:text-accent">
          <Database aria-hidden="true" size={13} strokeWidth={1.7} />
          Assets
        </a>
        <a href="/trash" aria-label="Trash" className="flex h-7 items-center justify-center gap-1.5 rounded-[4px] border border-edge bg-raised px-2 font-mono text-[11px] text-muted no-underline transition-colors hover:border-edge-bright hover:text-accent">
          <Trash2 aria-hidden="true" size={13} strokeWidth={1.7} />
          Trash
        </a>
      </nav>

      {dialog && <CreateDialog kind={dialog} parentId={parentId} onClose={() => setDialog(null)} onCreated={onCreated} />}
    </div>
  );
}
