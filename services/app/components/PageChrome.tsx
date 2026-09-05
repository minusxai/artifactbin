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
/** The framed document's chrome asks the page to open one of its panels. */
const REQUEST_EVENT = 'mx:page-chrome-request';
/** A panel says whether it is open, so the bar's button can show the X. */
const STATE_EVENT = 'mx:page-chrome-state';
function announcePanel(which: 'menu' | 'controls', open: boolean) {
  window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: { which, open } }));
}
export function requestPageChrome(which: 'menu' | 'controls') {
  window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: which }));
}
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

/** What a framed document can say about its own scroll port, which is all the
 * page knows: where the reader is, and whether there is anything below them.
 * The second is the document's answer because the page cannot measure an
 * opaque frame (lib/story-runtime/contract StoryScrollMessage). */
export interface PageChromeScrollSample {
  scrollY: number;
  atBottom: boolean;
}

export function notifyPageChromeScroll(scrollY: number, atBottom = false) {
  window.dispatchEvent(
    new CustomEvent<PageChromeScrollSample>(PAGE_CHROME_SCROLL_EVENT, { detail: { scrollY, atBottom } }),
  );
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
  /** Whether a framed document has told us where it is yet. Its offsets and
   * this page's own are different numbers about different surfaces. */
  const framedSeeded = useRef(false);

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
    /*
     * THE END OF THE PAGE OUTRANKS THE DIRECTION. Hiding on a downward scroll
     * is right in the middle of a long page and wrong at the bottom of one:
     * the reader has stopped looking for more page and started looking for the
     * controls, the footer is what is under the bar, and there is no further
     * downward scroll left that could bring it back. The slack absorbs
     * subpixel rounding and the mobile URL bar, which changes `innerHeight`
     * under us as it collapses.
     */
    const atPageBottom = () =>
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    const update = (nextValue: number, bottom = false) => {
      const next = Math.max(0, nextValue);
      const delta = next - lastScrollY.current;
      if (next <= 24 || bottom) setScrollVisible(true);
      else if (delta >= 4 && next > 72) setScrollVisible(false);
      else if (delta <= -4) setScrollVisible(true);
      if (Math.abs(delta) >= 4 || next <= 24) lastScrollY.current = next;
    };
    const onWindowScroll = () => update(window.scrollY, atPageBottom());
    /*
     * A FRAMED DOCUMENT'S FIRST SAMPLE IS A BASELINE, NOT A DIRECTION. The
     * baseline above is this page's own `scrollY`, which on an artifact page is
     * 0 and stays 0 — the page never scrolls, the document inside it does. Read
     * against a frame's offsets that made every reload of a document the reader
     * was part-way through look like one enormous downward scroll, and the bar
     * left from a standstill. The frame's own first offset is the only honest
     * baseline for the frame's offsets; it says nothing about direction, so it
     * decides nothing.
     *
     * `atBottom` travels WITH the sample for the same reason: this page's
     * metrics cannot see the end of an opaque document, so without it the
     * end-of-page rule — the bar stays up where the footer is, because there is
     * no further downward scroll left to bring it back — was lost for every
     * framed document.
     */
    const onArtifactScroll = (event: Event) => {
      const { scrollY, atBottom } = (event as CustomEvent<PageChromeScrollSample>).detail;
      if (!framedSeeded.current) {
        framedSeeded.current = true;
        lastScrollY.current = Math.max(0, scrollY);
        return;
      }
      update(scrollY, atBottom);
    };
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

/** Open on the framed chrome's request — exclusively, like a click on the trigger. */
function useOpenOnRequest(which: 'menu' | 'controls', open: boolean, setOpen: (open: boolean) => void) {
  const id = useId();
  useEffect(() => {
    const onRequest = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== which) return;
      if (open) { setOpen(false); return; }
      window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
      setOpen(true);
    };
    window.addEventListener(REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(REQUEST_EVENT, onRequest);
  }, [id, open, setOpen, which]);
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
  triggerless = false,
}: {
  authed: boolean;
  anon?: boolean;
  title?: string | null;
  fixed?: boolean;
  /** Sit in the contextual editor bar instead of floating over the page. */
  toolbar?: boolean;
  /** No button of its own: the framed document's chrome opens it (requestPageChrome). */
  triggerless?: boolean;
}) {
  const pathname = usePathname() ?? '';
  const trail = crumbsFor(pathname, title);
  const [open, setOpen] = useState(false);
  const phone = useIsPhoneViewport();
  const mobileBar = useMobileBarLayer(open);
  const toggle = useExclusiveLayer(open, setOpen);
  useOpenOnRequest('menu', open, setOpen);
  useEffect(() => { announcePanel('menu', open); }, [open]);

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
        className={`fixed inset-0 z-40 cursor-default border-0 p-0 ${triggerless && !phone ? 'bg-transparent' : 'bg-black/25'}`}
      />
      <nav
        aria-label="Menu"
        /* Opened from the framed chrome it is a DROPDOWN under the bar (a bottom
           sheet on a phone), the twin of the controls panel; on its own it stays
           the app's left drawer. */
        className={triggerless
          ? (phone
            ? 'fixed inset-x-0 bottom-0 z-50 flex animate-[rise_.14s_ease-out] flex-col rounded-t-[10px] border-t border-edge bg-surface p-3 pb-[max(20px,env(safe-area-inset-bottom))] shadow-xl'
            : 'fixed right-3 top-14 z-50 flex w-72 animate-[rise_.14s_ease-out] flex-col rounded-[7px] border border-edge bg-surface p-2 shadow-xl')
          : 'fixed inset-y-0 left-0 z-50 flex w-full animate-[drawer-in_.15s_ease-out] flex-col border-r border-edge bg-surface p-2 pt-16 shadow-xl sm:w-72'}
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
          aria-label="Hosted at artifactbin"
          className="mb-3 flex items-center gap-2.5 px-2 font-mono text-sm font-semibold text-fg no-underline transition-colors hover:text-accent"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-128.png" alt="" className="h-7 w-7" />
          artifactbin
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
        {link('/docs-human', 'Human Docs', <BookOpen size={15} strokeWidth={1.5} />, pathname === '/docs-human')}
        {link('/docs/artifactbin/SKILL.md', 'Agent docs', <Braces size={15} strokeWidth={1.5} />, pathname === '/docs/artifactbin/SKILL.md')}

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
      {!triggerless && <Tooltip content={open ? 'close menu' : 'menu'} positioning={{ placement: mobileBar && phone ? 'top-start' : 'bottom-start' }}>
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
      </Tooltip>}
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

/**
 * WHAT THE PAGE IS RIGHT NOW. The pre-paint script in web/index.html has
 * already stamped the reader's stored choice by the time React mounts, so the
 * document is the only honest source for the control's opening state — a
 * constant here can only disagree with what the reader is looking at, and did:
 * it still said 'dark' after the default was flipped to light, so anyone who
 * had never touched the toggle was told they were in dark mode on a light
 * page. Reading the attribute also survives the default being flipped again.
 */
const currentAppAppearance = (): AppearanceMode =>
  typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

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
  triggerless = false,
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
  /** No button of its own: the framed document's chrome opens it (requestPageChrome). */
  triggerless?: boolean;
}) {
  const phone = useIsPhoneViewport();
  const [open, setOpen] = useState(false);
  const mobileBar = useMobileBarLayer(open);
  const [appMode, setAppMode] = useState<AppearanceMode>(currentAppAppearance);
  const toggle = useExclusiveLayer(open, setOpen);
  useOpenOnRequest('controls', open, setOpen);
  useEffect(() => { announcePanel('controls', open); }, [open]);
  const mode = controlledMode ?? appMode;

  // Re-reads the page when a controlled document hands the control back. The
  // question "what mode is this" is asked HERE and in the initial state, and
  // it used to be spelled out twice — the second copy still tested for a
  // 'light' attribute that light, being the default, never carries.
  useEffect(() => {
    if (controlledMode) return;
    setAppMode(currentAppAppearance());
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
      {!triggerless && <Tooltip content={label.toLowerCase()} positioning={{ placement: mobileBar && phone ? 'top-end' : 'bottom-end' }}>
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
      </Tooltip>}

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

const BAR_BUTTON =
  'flex h-9 w-9 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent text-muted transition-colors hover:bg-raised hover:text-fg';

/**
 * ONE BAR, ALWAYS THERE. The app pages used to float a hamburger in one corner
 * and a controls button in the other (a dock on phones); now they carry one
 * 44px bar in the page's own flow — the logo home on the left, the page's crumb
 * beside it, and the two panels' buttons on the right — the same shape the
 * reader's document bar has, so moving between a document and the app does
 * not change where anything is. Sticky, not fixed, so it never covers content.
 */
export function AppBar({ title, label = 'Page controls' }: { title?: string | null; label?: string }) {
  const pathname = usePathname() ?? '';
  const trail = crumbsFor(pathname, title);
  const [openPanel, setOpenPanel] = useState<'menu' | 'controls' | null>(null);
  useEffect(() => {
    const onState = (event: Event) => {
      const { which, open } = (event as CustomEvent<{ which: 'menu' | 'controls'; open: boolean }>).detail;
      setOpenPanel((current) => (open ? which : current === which ? null : current));
    };
    window.addEventListener(STATE_EVENT, onState);
    return () => window.removeEventListener(STATE_EVENT, onState);
  }, []);
  const control = (which: 'menu' | 'controls', name: string, icon: React.ReactNode) => {
    const open = openPanel === which;
    return (
      <Tooltip content={name} positioning={{ placement: 'bottom-end' }}>
        <button
          type="button"
          aria-label={open ? `Close ${name}` : `Open ${name}`}
          aria-expanded={open}
          onClick={() => requestPageChrome(which)}
          className={`${BAR_BUTTON} ${open ? 'text-accent' : ''}`}
        >
          {open ? <X size={17} strokeWidth={1.5} /> : icon}
        </button>
      </Tooltip>
    );
  };
  return (
    <header aria-label="Page bar" className="sticky top-0 z-40 flex h-11 items-center gap-3 border-b border-edge bg-surface/85 px-3 backdrop-blur-md">
      <a href="/" aria-label="Home" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] no-underline transition-colors hover:bg-raised">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-128.png" alt="" className="h-7 w-7" />
      </a>
      {trail.length > 0 && (
        <nav aria-label="Current page" className="flex min-w-0 items-center gap-1 font-mono text-xs text-muted">
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
        </nav>
      )}
      <div className="ml-auto flex items-center gap-1">
        {control('controls', label.toLowerCase(), <SlidersHorizontal size={17} strokeWidth={1.5} />)}
        {control('menu', 'menu', <User size={17} strokeWidth={1.5} />)}
      </div>
    </header>
  );
}

export default function PageChrome({
  authed,
  anon = false,
  title,
  label = 'Page controls',
  children,
}: {
  authed: boolean;
  anon?: boolean;
  title?: string | null;
  /** The controls panel's name — "Artifact controls" on an artifact page. */
  label?: string;
  /** Extra rows for the controls panel (an artifact's own actions). */
  children?: React.ReactNode | ((close: () => void) => React.ReactNode);
}) {
  return (
    <>
      <AppBar title={title} label={label} />
      <PageMenu authed={authed} anon={anon} title={title} fixed triggerless />
      <PageControls fixed triggerless label={label}>{children}</PageControls>
    </>
  );
}
