/* @jsxImportSource solid-js */
import { Show, createSignal, onMount, type JSX } from 'solid-js';
import { personFaceBackground, personInitial } from '@/lib/person-face';
import { refName } from '@/lib/story/dataflow';
import { useIsland } from '../context';
import type { PersonCard } from '@artifactbin/contracts';

type Props = { userId?: unknown; id?: string; fallback?: string; className?: string; link?: boolean; avatar?: boolean | string; size?: 'sm' | 'md' | 'lg'; decorative?: boolean; children?: JSX.Element; [key: string]: unknown };
const join = (...v: (string | false | undefined)[]) => v.filter(Boolean).join(' ');
const hasId = (v: unknown) => typeof v === 'string' ? v !== '' : v != null;
function identity(p: Props) { const island = useIsland(); const name = typeof p.userId === 'string' ? refName(p.userId) : null; const id = name ? island.value(name) : p.userId; return { id, card: typeof id === 'string' && id.startsWith('usr_') ? island.people()[id] : undefined }; }
const rest = (p: Props) => { const { userId,id,card,avatar,link,fallback,className,size,decorative,children,...other } = p; void userId; void card; void avatar; void link; void fallback; void className; void size; void decorative; void children; return { id, ...other }; };
export function UserHandle(p: Props) {
  const who = () => identity(p); const card = (): PersonCard | undefined => who().card;
  return <Show when={hasId(who().id)} fallback={p.fallback ? <span data-slot="user-handle" class={join('text-muted-foreground',p.className)} {...rest(p)}>{p.fallback}</span> : null}>
    <Show when={card()} fallback={<span data-slot="user-handle" data-unknown="" class={join('text-muted-foreground',p.className)} {...rest(p)}>Unknown person</span>}>
      <Show when={card()?.handle} fallback={<span data-slot="user-handle" class={p.className} {...rest(p)}>{card()?.name}</span>}>
        <Show when={p.link !== false} fallback={<span data-slot="user-handle" class={p.className} {...rest(p)}>@{card()?.handle}</span>}>
          <a data-slot="user-handle" href={`/@${card()?.handle}`} target="_top" rel="noopener" class={join('underline-offset-2 hover:underline',p.className)} {...rest(p)}>@{card()?.handle}</a>
        </Show>
      </Show>
    </Show>
  </Show>;
}
const BOX = { sm: 'size-5', md: 'size-8', lg: 'size-12' };
const GLYPH = { sm: 'text-[10px]', md: 'text-xs', lg: 'text-base' };
const AVATAR = 'group/avatar relative shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6';
const FALLBACK = 'flex size-full items-center justify-center rounded-full bg-muted text-muted-foreground group-data-[size=sm]/avatar:text-xs';
export function UserImage(p: Props) {
  const who = () => identity(p); const card = () => who().card; const size = () => p.size ?? 'sm'; const [failed,setFailed] = createSignal<string | null>(null);
  const box = () => join('inline-flex shrink-0 align-middle',BOX[size()],p.className);
  return <Show when={hasId(who().id)} fallback={p.fallback ? <span data-slot="user-image" class={join('text-muted-foreground',p.className)} {...rest(p)}>{p.fallback}</span> : null}>
    <span data-slot="avatar" data-size="default" data-unknown={!card() ? '' : undefined} aria-hidden={p.decorative || !card() ? 'true' : undefined}
      role={!p.decorative && card() && !card()?.image ? 'img' : undefined} aria-label={!p.decorative && card() && !card()?.image ? card()?.name : undefined}
      class={join(AVATAR,box())} style={card() && typeof who().id === 'string' ? { 'background-color': personFaceBackground(who().id as string) } : undefined} {...rest(p)}>
      <span data-slot="avatar-fallback" class={join(FALLBACK,card() && 'bg-transparent font-medium text-white',GLYPH[size()])}>{card() ? personInitial(card()!.name) : '?'}</span>
      <Show when={card()?.image && failed() !== card()?.image}><img data-slot="avatar-image" class="absolute inset-0 aspect-square size-full object-cover" src={card()!.image!} alt={p.decorative ? '' : card()!.name} aria-hidden={p.decorative ? 'true' : undefined} onError={() => setFailed(card()!.image)} /></Show>
    </span>
  </Show>;
}
export function User(p: Props) {
  const who = () => identity(p);
  return <Show when={hasId(who().id)} fallback={p.fallback ? <span data-slot="user" class={join('text-muted-foreground',p.className)} {...rest(p)}>{p.fallback}</span> : null}>
    <span data-slot="user" class={join('inline-flex items-center gap-1.5 align-middle',p.className)} {...rest(p)}>
      <Show when={p.avatar !== false && p.avatar !== 'false'}><UserImage userId={who().id} size="sm" decorative /></Show>
      <UserHandle userId={who().id} link={p.link} />
    </span>
  </Show>;
}
const SIGN_IN_CLASS = "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 has-[>svg]:px-3";
const returnHref = () => { const at = window.location; return at.pathname === '/' || at.pathname === '/login' ? '/login' : `/login?callbackUrl=${encodeURIComponent(at.pathname + at.search + at.hash)}`; };
export function SignIn(p: Props) {
  const island = useIsland(); const { children,className,...other } = p; const [href,setHref] = createSignal('/login'); onMount(() => setHref(returnHref()));
  return <Show when={!island.viewer() || 'hinted' in island.viewer()!}><a data-slot="sign-in" href={href()} on:click={e => { e.currentTarget.href = returnHref(); }} target="_top" rel="noopener" class={join(SIGN_IN_CLASS,className)} {...other}>{children ?? 'Sign in'}</a></Show>;
}
