'use client';

/**
 * "share" — ONE button. For an owner it opens the centered sharing dialog: copy link,
 * the READ acl (visibility), the PEOPLE (invited emails, each with a role —
 * `can view` or `can edit`, under EVERY visibility, because a public
 * document can have editors too) and, for a dataset, the WRITE acl (the
 * access toggle and who writes to it) together, so there is a single place
 * to answer "who can see this, who can change it, and how do I hand it to
 * them". An anonymous owner manages all of that except `private`, which
 * needs an account to anchor its ACL and is hidden from them; someone who
 * owns nothing here gets a plain one-click copy.
 *
 * The URL is location minus the fragment on purpose: #edit is a MODE, never
 * part of the link you hand someone. Shelf menus pass the selected artifact's
 * address explicitly. The ACL
 * surface is session-only (/api/my/artifacts/<id>/sharing).
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crop, Check, EyeOff, Globe, Link as LinkIcon, Lock, PenLine, X } from 'lucide-react';
import { SelectMenu } from '@/components/SelectMenu';
import { Tooltip } from '@/components/Tooltip';
import type { DatasetAccess, SharingPatch, Visibility } from '@/lib/artifacts';
import { SHARE_ROLES, SHARE_ROLE_LABEL, type ShareEntry, type ShareRole } from '@/lib/share-roles';

interface SharingState {
  visibility: Visibility;
  /** GENERAL ACCESS: what the link grants whoever holds it. Meaningless while `private`. */
  linkRole: ShareRole;
  shares: ShareEntry[];
  /** Datasets: the WRITE ACL and the documents that would stop working without it. */
  access?: DatasetAccess;
  writtenBy?: Array<{ id: string; title: string | null; mutations: string[] }>;
  /** False for an anonymous owner — `private` has no ACL to anchor without an account. */
  canPrivate?: boolean;
}

const VISIBILITY_ICONS = { public: Globe, unlisted: EyeOff, private: Lock } as const;

/**
 * The role list, as the house dropdown wants it. A native <select> draws its
 * options with OS widgets, which lands system chrome in the middle of a
 * terminal-graphite panel — so both role controls here are SelectMenu
 * listboxes over the SAME options, because they are the same question asked
 * of a link and of a person.
 */
const ROLE_OPTIONS = SHARE_ROLES.map((r) => ({ value: r, label: SHARE_ROLE_LABEL[r] }));

export default function ShareLink({
  className,
  artifactId,
  title,
  owner = false,
  format,
  variant = 'chip',
  url,
  onClose,
  onSocialPreview,
}: {
  className: string;
  /** Enables the ACL dialog; without it this is just the copy button. */
  artifactId?: string;
  /** The displayed name of the artifact being shared. */
  title?: string | null;
  /** This viewer OWNS the artifact — only an owner manages its ACL; editors may still configure the social preview. */
  owner?: boolean;
  /** The artifact's format — the writes row exists for a dataset and nothing else. */
  format?: string;
  /** `menu` is a document-control row; `dialog` opens directly from an external menu. */
  variant?: 'chip' | 'menu' | 'dialog';
  /** Explicit artifact address when opened from a shelf or table. */
  url?: string;
  /** Dialog-only callers unmount the sharing surface when dismissed. */
  onClose?: () => void;
  /** Editors may configure the card without managing access. */
  onSocialPreview?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(variant === 'dialog');
  const [state, setState] = useState<SharingState | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Closing writes with documents that write here asks once — see below. */
  const [confirmReadOnly, setConfirmReadOnly] = useState(false);

  // Revert through an effect so unmounting mid-flash cancels the timer.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const canManage = owner && !!artifactId;

  // Loaded on MOUNT, not on open: the button itself carries the verdict
  // ("share: public"), so it must know the answer before any click.
  useEffect(() => {
    if (!canManage || state) return;
    void (async () => {
      const res = await fetch(`/api/my/artifacts/${artifactId}/sharing`).catch(() => null);
      if (res?.ok) setState((await res.json()) as SharingState);
      else setError('could not load sharing');
    })();
  }, [canManage, artifactId, state]);

  const put = async (patch: SharingPatch) => {
    setError(null);
    const res = await fetch(`/api/my/artifacts/${artifactId}/sharing`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (res?.ok) setState((await res.json()) as SharingState);
    else setError('could not update sharing');
  };

  const copyLink = () => {
    void navigator.clipboard?.writeText(url ? new URL(url, location.origin).href : `${location.origin}${location.pathname}`);
    setCopied(true);
  };

  if (!canManage && !onSocialPreview) {
    if (variant === 'menu') {
      return (
        <button
          type="button"
          aria-label="Share"
          onClick={copyLink}
          className="flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-2 text-left font-mono text-xs text-muted transition-colors hover:bg-raised hover:text-fg"
        >
          {copied ? <Check size={14} /> : <LinkIcon size={14} />}
          {copied ? 'copied link' : 'share'}
        </button>
      );
    }
    return (
      <Tooltip content={copied ? 'copied!' : 'copy link'}>
        <button type="button" aria-label="Share" onClick={copyLink} className={className}>
          {copied ? <Check size={12} /> : <LinkIcon size={12} />} <span className="hidden sm:inline">{copied ? 'copied' : 'share'}</span>
        </button>
      </Tooltip>
    );
  }

  const VerdictIcon = VISIBILITY_ICONS[state?.visibility ?? 'private'];
  /*
   * The WRITES row (datasets only).
   *
   * It lives here rather than in its own control because it answers the same
   * question the rest of this dialog does: who can do what with this thing.
   * `visibility` is who may READ it; `access` is who may CHANGE it through a
   * document. Neither implies the other, so they are two rows, not one picker.
   */
  const writable = state?.access === 'readwrite';
  const writers = state?.writtenBy ?? [];
  const showWrites = format === 'dataset' && !!state;
  const setAccess = (next: DatasetAccess) => {
    // Closing writes never touches the ROWS — every mutate call re-checks — but
    // it does stop the documents that write, so it says which ones first. With
    // nothing writing here there is nothing to warn about, and it just flips.
    if (next === 'read' && writers.length > 0 && !confirmReadOnly) { setConfirmReadOnly(true); return; }
    setConfirmReadOnly(false);
    void put({ access: next });
  };
  const toggle = () => setOpen((o) => !o);
  return (
    <span className={variant === 'menu' ? 'relative block' : 'relative inline-flex items-center gap-1'}>
      {variant === 'dialog' ? null : variant === 'menu' ? (
        <button
          type="button"
          aria-label="Share"
          onClick={toggle}
          className={`flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-2 text-left font-mono text-xs transition-colors hover:bg-raised hover:text-fg ${open ? 'text-accent' : 'text-muted'}`}
        >
          <VerdictIcon size={14} />
          <span>{state ? `sharing · ${state.visibility}` : 'sharing'}</span>
        </button>
      ) : (
      <Tooltip content="share / who can view" positioning={{ placement: 'bottom-end' }}>
        <button
          type="button"
          aria-label="Share"
          onClick={toggle}
          className={className}
        >
          <VerdictIcon size={12} />{' '}
          {/* The compact chip keeps its text from crowding a narrow toolbar. */}
          <span className="hidden whitespace-nowrap sm:inline">
            {state ? <>share: {state.visibility}</> : 'share'}
            {showWrites && writable && <span className="text-amber-500"> · writable</span>}
          </span>
        </button>
      </Tooltip>
      )}
      {open && (
        <SharePanel title={`Share “${title ?? (format === 'folder' ? 'Untitled folder' : 'Untitled')}”`} onClose={() => { setOpen(false); onClose?.(); }}>
          <button
            type="button"
            aria-label="Copy link"
            onClick={copyLink}
            className="mb-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[5px] border border-edge bg-raised px-3 py-2.5 text-muted hover:border-edge-bright hover:text-fg"
          >
            {copied ? <Check size={11} /> : <LinkIcon size={11} />} {copied ? 'copied' : 'copy link'}
          </button>
          {onSocialPreview && (
            <button type="button" aria-label="Edit social preview" onClick={() => { setOpen(false); onSocialPreview(); }} className="mb-4 flex w-full cursor-pointer items-center gap-2 rounded-[5px] border border-edge px-3 py-2.5 text-muted hover:border-edge-bright hover:text-fg">
              <Crop size={14} /> social preview <span className="ml-auto text-[11px] text-faint">upload image or frame document</span>
            </button>
          )}
          {canManage && !state && !error && <p className="text-muted">loading…</p>}
          {error && <p className="text-red-400">{error}</p>}
          {state && (
            <>
              <div className="flex gap-1">
                {(
                  [
                    ['public', 'anyone with the link · listed on your profile'],
                    ['unlisted', 'anyone with the link · not listed anywhere'],
                    ['private', 'only you and invited emails'],
                  ] as const
                ).map(([v, tip]) => {
                  // `private` needs an account to anchor its ACL; an anonymous
                  // owner is not offered a tier the door would refuse.
                  if (v === 'private' && state.canPrivate === false) return null;
                  const Icon = VISIBILITY_ICONS[v];
                  return (
                    <Tooltip key={v} content={tip}>
                      <button
                        type="button"
                        aria-label={`Make ${v}`}
                        onClick={() => void put({ visibility: v })}
                      className={`flex-1 cursor-pointer rounded-[4px] border px-2 py-2.5 whitespace-nowrap ${state.visibility === v ? 'border-accent/40 bg-accent-soft text-accent' : 'border-edge text-muted hover:border-edge-bright hover:text-fg'}`}
                      >
                        <Icon size={11} className="mr-1 inline" /> {v}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
              {/*
                * GENERAL ACCESS, second half. The row above says who the LINK
                * REACHES; this says what it grants them once it has. Hidden
                * while `private`, where the link reaches nobody and a role
                * would be a control with no effect — the server still
                * REMEMBERS the choice, so coming back out of private restores
                * it rather than silently resetting to `can view`.
                */}
              {state.visibility !== 'private' && (
                <label className="mt-2 flex items-center justify-between gap-2 text-muted">
                  <span>anyone with the link</span>
                  <span className="w-32 shrink-0">
                    <SelectMenu
                      ariaLabel="Link role"
                      value={state.linkRole ?? 'viewer'}
                      options={ROLE_OPTIONS}
                      onChange={(v) => void put({ linkRole: v as ShareRole })}
                    />
                  </span>
                </label>
              )}
              {showWrites && (
                <div className="mt-5 border-t border-edge pt-4">
                  <p className="mb-1 flex items-center justify-between text-faint">
                    <span className="uppercase tracking-wider">writes</span>
                    <PenLine size={11} />
                  </p>
                  <div className="flex gap-1">
                    {([
                      ['read', 'read-only', 'documents may only read this data'],
                      ['readwrite', 'read & write', 'you and dataset editors may add, change and remove rows'],
                    ] as const).map(([value, label, tip]) => (
                      <Tooltip key={value} content={tip}>
                        <button
                          type="button"
                          aria-label={value === 'read' ? 'Make read-only' : 'Make read & write'}
                          aria-pressed={(state.access ?? 'read') === value}
                          onClick={() => setAccess(value)}
                          className={`flex-1 cursor-pointer rounded-[4px] border px-2 py-1.5 whitespace-nowrap ${(state.access ?? 'read') === value
                            ? value === 'readwrite'
                              ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                              : 'border-accent/40 bg-accent-soft text-accent'
                            : 'border-edge text-muted hover:border-edge-bright hover:text-fg'}`}
                        >
                          {label}
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                  <p className="mt-2 leading-relaxed text-muted">
                    {writable
                      ? 'Any document you publish with a <Mutation> on this dataset can add, change and remove rows — for everyone who can read that document. Every write is a version you can revert.'
                      : 'Documents can only read this dataset. A <Mutation> naming it is refused when you publish.'}
                  </p>
                  {writers.length > 0 && (
                    <div className="mt-2">
                      <p className="mb-1 uppercase tracking-wider text-faint">written by</p>
                      {writers.map((w) => (
                        <div key={w.id} className="flex items-center justify-between py-0.5">
                          <span className="truncate">{w.title ?? w.id}</span>
                          <span className="ml-2 shrink-0 text-faint">{w.mutations.join(', ')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {confirmReadOnly && (
                    <div role="alert" className="mt-2 rounded-[4px] border border-danger/40 bg-danger-soft p-2 leading-relaxed">
                      <span className="text-danger">{writers.length} document{writers.length === 1 ? '' : 's'} write{writers.length === 1 ? 's' : ''} here.</span>{' '}
                      Their buttons will stop working until you turn writes back on. The rows stay.
                      <div className="mt-1.5 flex gap-1">
                        <button
                          type="button"
                          aria-label="Confirm read-only"
                          onClick={() => { setConfirmReadOnly(false); void put({ access: 'read' }); }}
                          className="cursor-pointer rounded-[4px] border border-danger/40 px-2 py-1 text-danger hover:bg-danger/10"
                        >
                          make read-only
                        </button>
                        <button
                          type="button"
                          aria-label="Keep writable"
                          onClick={() => setConfirmReadOnly(false)}
                          className="cursor-pointer rounded-[4px] border border-edge px-2 py-1 text-muted hover:text-fg"
                        >
                          keep writable
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* PEOPLE — under every visibility. `can view` on a public
                  document grants nothing the link does not, and says so;
                  `can edit` is the whole reason the list is here at all. */}
              <div className="mt-5 border-t border-edge pt-4">
                <p className="mb-1 uppercase tracking-wider text-faint">people</p>
                {state.shares.map((e) => (
                  <div key={e.email} className="flex items-center justify-between gap-2 py-0.5">
                    <span className="min-w-0 truncate">{e.email}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Tooltip
                        content="already viewable by link"
                        disabled={state.visibility === 'private' || e.role === 'editor'}
                      >
                        <span className="w-32 shrink-0">
                          <SelectMenu
                            ariaLabel={`Role for ${e.email}`}
                            value={e.role}
                            options={ROLE_OPTIONS}
                            onChange={(v) => void put({ shares: state.shares.map((x) => (x.email === e.email ? { ...x, role: v as ShareRole } : x)) })}
                          />
                        </span>
                      </Tooltip>
                      <button
                        type="button"
                        aria-label={`Remove ${e.email}`}
                        onClick={() => void put({ shares: state.shares.filter((x) => x.email !== e.email) })}
                        className="cursor-pointer text-muted hover:text-fg"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  </div>
                ))}
                <form
                    className="mt-1 flex gap-1"
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      const addr = email.trim();
                      if (!addr) return;
                      // A new person starts as a viewer; the row's control promotes them.
                      void put({ shares: [...state.shares, { email: addr, role: 'viewer' }] });
                      setEmail('');
                    }}
                  >
                    <input
                      aria-label="Invite email"
                      placeholder="email@example.com"
                      value={email}
                      onChange={(ev) => setEmail(ev.target.value)}
                      className="min-w-0 flex-1 rounded-[4px] border border-edge bg-transparent px-2 py-1 text-fg outline-none focus:border-edge-bright"
                    />
                    <button
                      type="submit"
                      aria-label="Add email"
                      className="cursor-pointer rounded-[4px] border border-edge px-2 py-1 text-muted hover:border-edge-bright hover:text-fg"
                    >
                      add
                    </button>
                  </form>
              </div>
            </>
          )}
        </SharePanel>
      )}
    </span>
  );
}

/** One viewport-level sharing surface. Portaling keeps it centered even when
 * its trigger lives inside an animated controls popover. */
function SharePanel({ onClose, children, title }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-8">
      <button
        type="button"
        aria-label="Close sharing by clicking outside"
        onClick={onClose}
        className="absolute inset-0 cursor-default border-0 bg-black/45 p-0 backdrop-blur-[2px]"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Sharing"
        className="relative z-10 flex w-full max-w-2xl animate-[rise_.16s_ease-out] flex-col overflow-hidden rounded-[9px] border border-edge-bright bg-surface font-mono text-xs shadow-2xl"
        style={{ maxHeight: 'calc(100svh - 24px)' }}
      >
        <header className="flex items-start gap-4 border-b border-edge px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-base font-semibold text-fg">{title}</h2>
            <p className="mt-1 text-[11px] text-faint">Manage access, invite people, or copy the link.</p>
          </div>
          <button
            type="button"
            aria-label="Close sharing"
            autoFocus
            onClick={onClose}
            className="ml-auto inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-muted hover:bg-raised hover:text-fg"
          >
            <X size={16} />
          </button>
        </header>
        <div className="overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {children}
        </div>
      </section>
    </div>,
    document.body,
  );
}
