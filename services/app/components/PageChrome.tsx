'use client';

/**
 * Quiet page chrome. Desktop keeps two independent corner controls rather
 * than reserving a header; phones get one full-width bottom rail with Menu,
 * Home, and the current page's controls. A page may scroll the chrome away
 * with its content, while a full-viewport artifact overlays it.
 */
import {
  BookOpen, Braces, ChevronRight, FileText, House, LogIn, LogOut, Menu, Moon,
  SlidersHorizontal, Sun, User, X,
} from 'lucide-react';
import { Children, createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import MobileSheet, { useIsPhoneViewport } from '@/components/MobileSheet';
import { Tooltip } from '@/components/Tooltip';
import { forgetTokens } from '@/lib/browser-session';
import { crumbsFor } from '@/lib/breadcrumb';
import { usePathname } from '@/lib/navigation';

export type AppearanceMode = 'light' | 'dark';

const EDGE = 12;
const OPEN_EVENT = 'mx:page-chrome-open';
const ITEM =
  'flex w-full items-center gap-3 rounded-[5px] border-0 bg-transparent px-3 py-3 text-left font-mono text-sm no-underline transition-colors sm:gap-2.5 sm:px-2.5 sm:py-2 sm:text-xs';
const FLOATING_BUTTON =
  'z-[60] flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-edge bg-surface/90 text-muted shadow-sm backdrop-blur-md transition-[color,background-color,transform] hover:bg-raised hover:text-fg active:scale-95';
const TOOLBAR_BUTTON =
  'fixed left-0 top-0 z-[60] flex h-12 w-12 cursor-pointer items-center justify-center border-0 bg-transparent text-muted shadow-none transition-colors hover:bg-raised hover:text-fg';
const MOBILE_BAR_BUTTON =
  'relative z-[60] flex h-11 w-11 cursor-pointer items-center justify-center rounded-full max-sm:flex-col max-sm:gap-0.5 max-sm:rounded-[8px] border-0 bg-transparent text-muted shadow-none transition-[color,background-color,transform] hover:bg-raised hover:text-fg active:scale-95 sm:h-9 sm:w-9 sm:border sm:border-edge sm:bg-surface/90 sm:shadow-sm sm:backdrop-blur-md';
const MOBILE_BAR_LABEL = 'font-mono text-[8px] leading-none tracking-[0.04em] sm:hidden';

/** Artifact iframes are opaque and scroll independently of their parent. The
 * trusted artifact page translates their scroll message into this local-only
 * event so the bar can use the same policy for both scrolling surfaces. */
export const PAGE_CHROME_SCROLL_EVENT = 'mx:page-chrome-scroll';

export function notifyPageChromeScroll(scrollY: number) {
  window.dispatchEvent(new CustomEvent<number>(PAGE_CHROME_SCROLL_EVENT, { detail: scrollY }));
}

interface MobileBarContextValue {
  setLayerOpen: (id: string, open: boolean) => void;
}

const MobileBarContext = createContext<MobileBarContextValue | null>(null);

function useMobileBarLayer(open: boolean) {
  const bar = useContext(MobileBarContext);
  const id = useId();
  useEffect(() => {
    if (!bar) return;
    bar.setLayerOpen(id, open);
    return () => bar.setLayerOpen(id, false);
  }, [bar, id, open]);
  return bar !== null;
}

/** The page actions and Home become one thumb-reachable rail below `sm`.
 * Desktop keeps the existing independent corner controls via `display:
 * contents`. Direction changes use a small dead zone so touch-scroll jitter
 * does not make the rail flicker. */
export function PageChromeBar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const [scrollVisible, setScrollVisible] = useState(true);
  const [openLayers, setOpenLayers] = useState<Set<string>>(() => new Set());
  const lastScrollY = useRef(0);

  const setLayerOpen = useCallback((id: string, open: boolean) => {
    setOpenLayers((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
    // Closing a sheet or drawer should hand the controls straight back.
    setScrollVisible(true);
  }, []);

  useEffect(() => {
    lastScrollY.current = Math.max(0, window.scrollY);
    const update = (nextValue: number) => {
      const next = Math.max(0, nextValue);
      const delta = next - lastScrollY.current;
      if (next <= 24) setScrollVisible(true);
      else if (delta >= 4 && next > 72) setScrollVisible(false);
      else if (delta <= -4) setScrollVisible(true);
      if (Math.abs(delta) >= 4 || next <= 24) lastScrollY.current = next;
    };
    const onWindowScroll = () => update(window.scrollY);
    const onArtifactScroll = (event: Event) => update((event as CustomEvent<number>).detail);
    window.addEventListener('scroll', onWindowScroll, { passive: true });
    window.addEventListener(PAGE_CHROME_SCROLL_EVENT, onArtifactScroll);
    return () => {
      window.removeEventListener('scroll', onWindowScroll);
      window.removeEventListener(PAGE_CHROME_SCROLL_EVENT, onArtifactScroll);
    };
  }, []);

  const context = useMemo(() => ({ setLayerOpen }), [setLayerOpen]);
  const visible = scrollVisible && openLayers.size === 0;
  const [leadingAction, ...trailingActions] = Children.toArray(children);

  return (
    <MobileBarContext.Provider value={context}>
      <div
        role="toolbar"
        aria-label="Page actions"
        data-scroll-hidden={visible ? 'false' : 'true'}
        data-mobile-bar="full"
        onFocusCapture={() => setScrollVisible(true)}
        className={`fixed inset-x-0 bottom-0 z-[60] w-full border-t border-edge bg-surface/92 pt-1 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur-xl transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none sm:contents ${
          visible
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-full opacity-0 sm:pointer-events-auto sm:translate-y-0 sm:opacity-100'
        }`}
        style={{ paddingBottom: 'max(4px, env(safe-area-inset-bottom))' }}
      >
        <div className="grid h-12 w-full grid-cols-3 items-center sm:contents">
          <div data-mobile-bar-slot="menu" className="flex w-full justify-center sm:contents">{leadingAction}</div>
          <a
            href="/"
            aria-label="Home"
            aria-current={pathname === '/' ? 'page' : undefined}
            className={`flex h-11 w-11 flex-col items-center justify-center justify-self-center gap-0.5 rounded-[8px] text-muted no-underline transition-[color,background-color,transform] hover:bg-raised hover:text-fg active:scale-95 sm:hidden ${
              pathname === '/' ? 'text-accent' : ''
            }`}
          >
            <House size={18} strokeWidth={1.5} />
            <span data-mobile-label="" className={MOBILE_BAR_LABEL}>home</span>
          </a>
          <div data-mobile-bar-slot="controls" className="flex w-full justify-center sm:contents">{trailingActions}</div>
        </div>
      </div>
    </MobileBarContext.Provider>
  );
}

function useExclusiveLayer(open: boolean, setOpen: (open: boolean) => void) {
  const id = useId();
  useEffect(() => {
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false);
    };
    window.addEventListener(OPEN_EVENT, closeOther);
    return () => window.removeEventListener(OPEN_EVENT, closeOther);
  }, [id, setOpen]);
  const toggle = () => {
    const next = !open;
    if (next) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    setOpen(next);
  };
  return toggle;
}

function triggerPosition(side: 'left' | 'right', fixed: boolean, open: boolean) {
  const position = fixed || open ? 'fixed' : 'absolute';
  return `${position} top-3 ${side === 'left' ? 'left-3' : 'right-3'}`;
}

export function PageMenu({
  authed,
  anon = false,
  title,
  fixed = false,
  toolbar = false,
}: {
  authed: boolean;
  anon?: boolean;
  title?: string | null;
  fixed?: boolean;
  /** Sit in the contextual editor bar instead of floating over the page. */
  toolbar?: boolean;
}) {
  const pathname = usePathname() ?? '';
  const trail = crumbsFor(pathname, title);
  const [open, setOpen] = useState(false);
  const phone = useIsPhoneViewport();
  const mobileBar = useMobileBarLayer(open);
  const toggle = useExclusiveLayer(open, setOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const link = (href: string, label: string, icon: React.ReactNode, active: boolean) => (
    <a
      href={href}
      aria-label={label}
      className={`${ITEM} cursor-pointer ${active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg'}`}
      onClick={() => setOpen(false)}
    >
      {icon}
      {label}
    </a>
  );

  const layer = open && (
    <>
      <button
        type="button"
        aria-label="Close the menu"
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-40 cursor-default border-0 bg-black/25 p-0"
      />
      <nav
        aria-label="Menu"
        className="fixed inset-y-0 left-0 z-50 flex w-full animate-[drawer-in_.15s_ease-out] flex-col border-r border-edge bg-surface p-2 pt-16 shadow-xl sm:w-72"
      >
        <button
          type="button"
          aria-label="Dismiss menu"
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-edge bg-surface text-muted hover:bg-raised hover:text-fg sm:hidden"
          style={{ top: `max(${EDGE}px, env(safe-area-inset-top))` }}
        >
          <X size={17} strokeWidth={1.5} />
        </button>
        <a
          href="/"
          aria-label="Hosted at artifact-bin"
          className="mb-3 flex items-center gap-2.5 px-2 font-mono text-sm font-semibold text-fg no-underline transition-colors hover:text-accent"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-128.png" alt="" className="h-7 w-7" />
          artifact-bin
        </a>

        {trail.length > 0 && (
          <div aria-label="Current page" className="mb-3 flex min-w-0 items-center gap-1 border-y border-edge px-2 py-2 font-mono text-xs text-muted">
            {trail.map((crumb, index) => (
              <span key={`${crumb.href ?? ''}:${crumb.label}`} className="flex min-w-0 items-center gap-1">
                {index > 0 && <ChevronRight size={12} className="shrink-0 text-faint" aria-hidden="true" />}
                {crumb.href ? (
                  <a href={crumb.href} className="shrink-0 text-muted no-underline hover:text-accent">{crumb.label}</a>
                ) : (
                  <span className="min-w-0 truncate text-fg">{crumb.label}</span>
                )}
              </span>
            ))}
          </div>
        )}

        {link('/', 'Artifacts', <FileText size={15} strokeWidth={1.5} />, pathname === '/')}
        {link('/account', 'Account', <User size={15} strokeWidth={1.5} />, pathname === '/account')}
        {link('/docs', 'Human Docs', <BookOpen size={15} strokeWidth={1.5} />, pathname.startsWith('/docs') && pathname !== '/docs/artifact-bin/SKILL.md')}
        {link('/docs/artifact-bin/SKILL.md', 'Agent docs', <Braces size={15} strokeWidth={1.5} />, pathname === '/docs/artifact-bin/SKILL.md')}

        <div className="mt-auto" />
        <div className="my-1 h-px bg-edge" />
        {authed ? (
          <button
            type="button"
            aria-label="Sign out"
            onClick={() => void fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
              .catch(() => null)
              .then(() => { window.location.href = '/'; })}
            className={`${ITEM} cursor-pointer text-muted hover:bg-raised hover:text-fg`}
          >
            <LogOut size={15} strokeWidth={1.5} />
            Sign out
          </button>
        ) : anon ? (
          <button
            type="button"
            aria-label="Disconnect this browser"
            onClick={() => void forgetTokens().then(() => { window.location.href = '/'; })}
            className={`${ITEM} cursor-pointer text-muted hover:bg-raised hover:text-fg`}
          >
            <LogOut size={15} strokeWidth={1.5} />
            Disconnect this browser
          </button>
        ) : (
          link('/login', 'Login', <LogIn size={15} strokeWidth={1.5} />, pathname === '/login')
        )}
      </nav>
    </>
  );

  return (
    <>
      <Tooltip content={open ? 'close menu' : 'menu'} positioning={{ placement: mobileBar && phone ? 'top-start' : 'bottom-start' }}>
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={toggle}
          data-chrome-placement={toolbar ? 'toolbar' : mobileBar && phone ? 'mobile-bar' : 'page'}
          className={toolbar
            ? TOOLBAR_BUTTON
            : mobileBar
              ? `${MOBILE_BAR_BUTTON} ${fixed || open ? 'sm:fixed' : 'sm:absolute'} sm:[top:max(12px,env(safe-area-inset-top))] sm:[left:max(12px,env(safe-area-inset-left))]`
              : `${triggerPosition('left', fixed, open)} ${FLOATING_BUTTON}`}
          style={toolbar || mobileBar ? undefined : { top: `max(${EDGE}px, env(safe-area-inset-top))`, left: `max(${EDGE}px, env(safe-area-inset-left))` }}
        >
          {open ? <X size={17} strokeWidth={1.5} /> : <Menu size={17} strokeWidth={1.5} />}
          {mobileBar && <span data-mobile-label="" className={MOBILE_BAR_LABEL}>menu</span>}
        </button>
      </Tooltip>
      {layer && mobileBar && phone ? createPortal(layer, document.body) : layer}
    </>
  );
}

function AppearancePicker({ mode, onPick }: { mode: AppearanceMode; onPick: (mode: AppearanceMode) => void }) {
  return (
    <section aria-label="Appearance">
      <h2 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">appearance</h2>
      <div role="group" aria-label="Color mode" className="flex overflow-hidden rounded-[5px] border border-edge">
        {([
          ['light', 'Light mode', <Sun key="sun" size={14} strokeWidth={1.5} />],
          ['dark', 'Dark mode', <Moon key="moon" size={14} strokeWidth={1.5} />],
        ] as const).map(([value, label, icon]) => (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={mode === value}
            onClick={() => onPick(value)}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-2 border-0 px-3 py-2 font-mono text-xs transition-colors ${
              mode === value ? 'bg-accent-soft text-accent' : 'bg-transparent text-muted hover:bg-raised hover:text-fg'
            }`}
          >
            {icon}
            {value}
          </button>
        ))}
      </div>
    </section>
  );
}

/** One reader choice, two surfaces: the app shell and (when supplied) the
 * artifact runtime. Keeping the app write here means controlled document
 * controls cannot accidentally skip the shell preference. */
function applyAppAppearance(mode: AppearanceMode) {
  // Light is the default and carries NO attribute (app/globals.css puts it on
  // bare `:root`), so dark is the one that gets stamped.
  if (mode === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('mx_theme', mode); } catch { /* private mode */ }
}

export function PageControls({
  fixed = false,
  rightOffset = EDGE,
  label = 'Page controls',
  mode: controlledMode,
  onModeChange,
  active = false,
  badge = 0,
  children,
}: {
  fixed?: boolean;
  /** Distance from the viewport's right edge. Artifact rails move the control
      to the document edge so it never covers the rail's own close button. */
  rightOffset?: number;
  label?: string;
  mode?: AppearanceMode;
  onModeChange?: (mode: AppearanceMode) => void;
  active?: boolean;
  badge?: number;
  children?: React.ReactNode | ((close: () => void) => React.ReactNode);
}) {
  const phone = useIsPhoneViewport();
  const [open, setOpen] = useState(false);
  const mobileBar = useMobileBarLayer(open);
  const [appMode, setAppMode] = useState<AppearanceMode>('dark');
  const toggle = useExclusiveLayer(open, setOpen);
  const mode = controlledMode ?? appMode;

  useEffect(() => {
    if (controlledMode) return;
    setAppMode(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, [controlledMode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const pickMode = (next: AppearanceMode) => {
    setAppMode(next);
    applyAppAppearance(next);
    onModeChange?.(next);
  };

  const close = () => setOpen(false);
  const body = (
    <div className="space-y-4">
      <AppearancePicker mode={mode} onPick={pickMode} />
      {children && (
        <div className="border-t border-edge pt-3">
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
  const header = (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h1 className="font-mono text-xs font-semibold text-fg">{label.toLowerCase()}</h1>
      <button type="button" aria-label={`Dismiss ${label.toLowerCase()}`} onClick={close} className="cursor-pointer rounded-[4px] p-1 text-muted hover:bg-raised hover:text-fg">
        <X size={15} strokeWidth={1.5} />
      </button>
    </div>
  );

  return (
    <>
      <Tooltip content={label.toLowerCase()} positioning={{ placement: mobileBar && phone ? 'top-end' : 'bottom-end' }}>
        <button
          type="button"
          aria-label={open ? `Close ${label.toLowerCase()}` : `Open ${label.toLowerCase()}`}
          aria-expanded={open}
          onClick={toggle}
          data-chrome-placement={mobileBar && phone ? 'mobile-bar' : 'page'}
          className={`${
            mobileBar
              ? `${MOBILE_BAR_BUTTON} ${fixed || open ? 'sm:fixed' : 'sm:absolute'} sm:[top:max(12px,env(safe-area-inset-top))] sm:[right:var(--mx-chrome-right)]`
              : `${triggerPosition('right', fixed, open)} ${FLOATING_BUTTON}`
          } ${active || open ? 'text-accent' : ''}`}
          style={mobileBar ? ({
            '--mx-chrome-right': rightOffset === EDGE ? `max(${EDGE}px, env(safe-area-inset-right))` : `${rightOffset}px`,
          } as React.CSSProperties) : {
            top: `max(${EDGE}px, env(safe-area-inset-top))`,
            right: rightOffset === EDGE ? `max(${EDGE}px, env(safe-area-inset-right))` : rightOffset,
          }}
        >
          {open ? <X size={17} strokeWidth={1.5} /> : <SlidersHorizontal size={17} strokeWidth={1.5} />}
          {mobileBar && <span data-mobile-label="" className={MOBILE_BAR_LABEL}>controls</span>}
          {badge > 0 && (
            <span aria-label="Open annotation count" className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] leading-none text-surface">
              {badge}
            </span>
          )}
        </button>
      </Tooltip>

      {open && (phone ? (
        <MobileSheet label={label} onClose={close} header={header}>{body}</MobileSheet>
      ) : (
        <>
          <button type="button" aria-label={`Close ${label.toLowerCase()} by clicking outside`} onClick={close} className="fixed inset-0 z-40 cursor-default border-0 bg-transparent p-0" />
          <aside
            role="dialog"
            aria-label={label}
            className="fixed right-3 top-14 z-50 w-72 animate-[rise_.14s_ease-out] rounded-[7px] border border-edge bg-surface p-3 font-mono text-xs shadow-xl"
            style={rightOffset === EDGE ? undefined : { right: rightOffset }}
          >
            {header}
            {body}
          </aside>
        </>
      ))}
    </>
  );
}

export default function PageChrome({ authed, anon = false }: { authed: boolean; anon?: boolean }) {
  return (
    <PageChromeBar>
      <PageMenu authed={authed} anon={anon} />
      <PageControls />
    </PageChromeBar>
  );
}
