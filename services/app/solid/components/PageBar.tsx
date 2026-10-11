/* @jsxImportSource solid-js */
/** One protected document bar, independent of routing, accounts and transports. */
import X from 'lucide-solid/icons/x';
import { Show, type JSX } from 'solid-js';
import logoUrl from '../../public/logo-128.png';
import { CHROME_IDENTITY } from './chrome-identity';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';

export function PageBar(props: { home?: string | null; logo?: JSX.Element; navigation: JSX.Element; mobileTitle?: string; actions: JSX.Element }): JSX.Element {
  return <header aria-label="Page bar" class="sticky top-0 z-40 flex h-11 items-center gap-2 max-[380px]:gap-1 max-[380px]:px-2 border-b border-edge bg-surface/85 px-3 backdrop-blur-md sm:gap-3">
    <Show when={props.home !== null} fallback={<span aria-label="artifactbin" class="flex h-9 w-9 shrink-0 items-center justify-center">{props.logo ?? <img src={logoUrl} alt="" width={CHROME_IDENTITY.logoSize} height={CHROME_IDENTITY.logoSize} class="shrink-0 object-contain" />}</span>}>
      <a href={props.home ?? '/'} aria-label="Home" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-control no-underline transition-colors hover:bg-raised">{props.logo ?? <img src={logoUrl} alt="" width={CHROME_IDENTITY.logoSize} height={CHROME_IDENTITY.logoSize} class="shrink-0 object-contain" />}</a>
    </Show>
    <span class="min-w-0 flex-1 truncate font-mono text-sm font-medium text-fg sm:hidden">{props.mobileTitle ?? 'artifactbin'}</span>
    <nav aria-label="Current page" class="hidden min-w-0 flex-1 items-center gap-2 font-mono text-fg sm:flex" style={{ 'font-size': `${CHROME_IDENTITY.fontSize}px`, 'font-weight': CHROME_IDENTITY.fontWeight }}>{props.navigation}</nav>
    <div class="ml-auto flex shrink-0 items-center gap-1 max-[380px]:gap-0">{props.actions}</div>
  </header>;
}

export function DocumentTitle(props: { title: string }): JSX.Element {
  return <span class="min-w-0 truncate font-semibold text-fg" data-mx-document-title="">{props.title}</span>;
}

/** Capability content varies; controls panel geometry and dismiss action do not. */
export function PageControlsPanel(props: { label: string; title: string; onClose: () => void; children: JSX.Element }): JSX.Element {
  return <Panel label={props.label} padding="sm" class="fixed right-3 top-14 z-50 max-h-[80vh] w-72 max-w-[calc(100vw-24px)] overflow-auto font-sans text-sm shadow-xl"><PageControlsBody title={props.title} onClose={props.onClose}>{props.children}</PageControlsBody></Panel>;
}

/** The controls panel's content — its title, the dismiss button and the rows — whichever surface holds it. */
export function PageControlsBody(props: { title: string; onClose: () => void; children: JSX.Element }): JSX.Element {
  return <><div class="mb-3 flex items-center justify-between"><h1 class="text-sm font-semibold">{props.title}</h1><Button variant="ghost" size="sm" icon aria-label={`Dismiss ${props.title}`} onClick={props.onClose}><X size={15} /></Button></div>{props.children}</>;
}
