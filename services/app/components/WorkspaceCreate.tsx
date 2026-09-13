'use client';

/**
 * THE WORKSPACE'S ONE CREATION DOOR: a Create button whose menu lists what a
 * workspace can hold, in the order a reader thinks of them — the documents
 * (artifact, folder) first, then under an "assets" rule the material those
 * documents are built from (file, dataset). Artifact and folder open the one
 * create dialog; file and dataset each go to their own page, where the upload
 * is previewed before and after it lands. A file picked from inside a folder
 * carries the folder along, so it is created there like everything else here.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Database, DatabasePlus, FilePlus2, FileUp, FolderPlus, Plus, Trash2, type LucideIcon } from 'lucide-react';
import CreateDialog, { type CreateKind } from '@/components/CreateDialog';

const ITEM =
  'group flex w-full cursor-pointer items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left font-mono text-[11.5px] text-fg no-underline transition-colors hover:bg-accent-soft hover:text-accent';

/** One row of the menu: a button, or a link when the door is another page. */
function MenuItem({ icon: Icon, label, href, onClick }: { icon: LucideIcon; label: string; href?: string; onClick: () => void }) {
  const body = (
    <>
      <Icon aria-hidden="true" size={14} strokeWidth={1.75} className="shrink-0 text-muted transition-colors group-hover:text-accent" />
      {label}
    </>
  );
  if (href) {
    return (
      <a href={href} role="menuitem" onClick={onClick} className={ITEM}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" role="menuitem" onClick={onClick} className={ITEM}>
      {body}
    </button>
  );
}

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
            <MenuItem icon={FilePlus2} label="Artifact" onClick={() => choose('artifact')} />
            <MenuItem icon={FolderPlus} label="Folder" onClick={() => choose('folder')} />
            {/* The rule and its label are the section: what follows is not a
              * document but the material one is built from. */}
            <div className="mt-1 border-t border-edge pt-1">
              <span className="block px-2.5 pt-1.5 pb-1 font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">assets</span>
              <MenuItem icon={FileUp} label="File" href={parentId ? `/files/new?parent_id=${encodeURIComponent(parentId)}` : '/files/new'} onClick={() => setOpen(false)} />
              <MenuItem icon={DatabasePlus} label="Dataset" href="/datasets/new" onClick={() => setOpen(false)} />
            </div>
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
