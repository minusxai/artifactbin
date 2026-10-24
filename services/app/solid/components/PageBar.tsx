/* @jsxImportSource solid-js */
/** One protected document bar, independent of routing, accounts and transports. */
import X from 'lucide-solid/icons/x';
import { Show, type JSX } from 'solid-js';
import logoUrl from '../../public/logo-128.png';
import { CHROME_IDENTITY } from './chrome-identity';
import { Button } from '../ui/Button';

export function PageBar(props: { home?: string | null; logo?: JSX.Element; navigation: JSX.Element; mobileTitle?: string; compactContext?: JSX.Element; compactNavigation?: boolean; actions: JSX.Element }): JSX.Element {
  return <header aria-label="Page bar" class="sticky top-0 z-40 flex h-11 items-center gap-2 max-[380px]:gap-1 max-[380px]:px-2 border-b border-edge bg-surface/85 px-3 backdrop-blur-md sm:gap-3">
    <Show when={props.home !== null} fallback={<span aria-label="artifactbin" class="flex h-9 w-9 shrink-0 items-center justify-center">{props.logo ?? <img src={logoUrl} alt="" width={CHROME_IDENTITY.logoSize} height={CHROME_IDENTITY.logoSize} class="shrink-0 object-contain" />}</span>}>
      <Button variant="ghost" size="bar" icon href={props.home ?? '/'} aria-label="Home">{props.logo ?? <img src={logoUrl} alt="" width={CHROME_IDENTITY.logoSize} height={CHROME_IDENTITY.logoSize} class="shrink-0 object-contain" />}</Button>
    </Show>
    <span class={`flex min-w-0 flex-1 items-center gap-2 font-mono text-sm font-medium text-fg ${props.compactNavigation ? 'lg:hidden' : 'sm:hidden'}`}><span class="min-w-0 truncate">{props.mobileTitle ?? 'artifactbin'}</span>{props.compactContext}</span>
    <nav aria-label="Current page" class={`hidden min-w-0 flex-1 items-center gap-2 font-mono text-fg ${props.compactNavigation ? 'lg:flex' : 'sm:flex'}`} style={{ 'font-size': `${CHROME_IDENTITY.fontSize}px`, 'font-weight': CHROME_IDENTITY.fontWeight }}>{props.navigation}</nav>
    <div class="ml-auto flex shrink-0 items-center gap-1 max-[380px]:gap-0">{props.actions}</div>
  </header>;
}

export function DocumentTitle(props: { title: string }): JSX.Element {
  return <span class="min-w-0 truncate font-semibold text-fg" data-mx-document-title="">{props.title}</span>;
}

/** The controls panel's content — its title, the dismiss button and the rows — whichever surface holds it. */
export function PageControlsBody(props: { title: string; onClose: () => void; children: JSX.Element }): JSX.Element {
  return <><div class="mb-3 flex items-center justify-between"><h1 class="text-sm font-semibold">{props.title}</h1><Button variant="ghost" size="sm" icon aria-label={`Dismiss ${props.title}`} onClick={props.onClose}><X size={15} /></Button></div>{props.children}</>;
}
