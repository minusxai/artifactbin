/**
 * <af-user>: person card; the app supplies identity (no account lookup happens in the element).
 * Import:  import {registerUser} from './components/user.js'; registerUser();  (load the .js in the browser; this .ts is the readable contract)
 * Props: person={id,name,handle,image,profileHref}, loading, error, identityState (unknown|missing|deleted), mode (user|avatar|handle), size (sm|md|lg)
 * To resolve a User ID from a linked dataset's typed user column, query that authorized namespace:
 *   const {data}=await client.query({query:gql`query($ids:[ID!]!){bookings{people(ids:$ids){id name handle image}}}`,variables:{ids:[userId]}});
 *   element.person=data.bookings.people.find(p=>p.id===userId)??null;
 * Only IDs present in that dataset's typed user columns resolve (at most 100 per request; dataset read permission is checked
 * before and after). Offline preview cannot resolve account cards. Keep an absent card null; never invent a name from the ID.
 * Usage:
 *   element.person={id:"u1",name:"Ada",handle:"ada",image:null,profileHref:"/u/ada"};
 */
import { personFaceBackground, personInitial } from '../islands';

export type UserSize = 'sm' | 'md' | 'lg';
export type UserMode = 'user' | 'avatar' | 'handle';
export type UserIdentityState = 'unknown' | 'missing' | 'deleted';
export type UserStatus = 'loading' | 'error' | 'person' | UserIdentityState;
export interface UserPerson {
  id: string;
  name?: string | null;
  handle?: string | null;
  image?: string | null;
  profileHref?: string | null;
}
export interface UserContract {
  person: UserPerson | null;
  loading: boolean;
  error: string | null;
  identityState: UserIdentityState;
  size: UserSize;
  mode: UserMode;
  avatar: boolean;
  link: boolean;
  decorative: boolean;
  fallback: string | undefined;
  profileHref: string | undefined;
  status: UserStatus;
}

const isSize = (value: string | null): value is UserSize => value === 'sm' || value === 'md' || value === 'lg';
const isMode = (value: string | null): value is UserMode => value === 'user' || value === 'avatar' || value === 'handle';
const isIdentityState = (value: string | null): value is UserIdentityState => value === 'unknown' || value === 'missing' || value === 'deleted';

function safeHref(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate || candidate.includes('\\') || candidate.startsWith('//')) return null;
  if (/^https?:\/\//i.test(candidate)) {
    try { const url = new URL(candidate); return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? candidate : null; }
    catch { return null; }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(candidate)) return null;
  try {
    const url = new URL(candidate, 'https://pagegi.invalid');
    return url.origin === 'https://pagegi.invalid' ? candidate : null;
  } catch { return null; }
}

function safeImageSource(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return safeHref(value);
}

function replayPreUpgradeProperties(element: HTMLElement, names: readonly string[]): void {
  const properties = element as unknown as Record<string, unknown>;
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(element, name)) continue;
    const value = properties[name]; delete properties[name]; properties[name] = value;
  }
}

export class AfUser extends HTMLElement implements UserContract {
  static observedAttributes = ['loading', 'error', 'identity-state', 'size', 'mode', 'avatar', 'link', 'decorative', 'fallback', 'profile-href'];
  private currentPerson: UserPerson | null = null;
  private avatarBox: HTMLElement | undefined;
  private fallbackNode: HTMLElement | undefined;
  private labelNode: HTMLElement | undefined;
  private nativeImage: HTMLImageElement | undefined;
  private nativeImageSrc: string | null = null;
  private imageState: 'empty' | 'loading' | 'loaded' | 'error' = 'empty';
  private generation = 0;
  private onImageLoad: (() => void) | undefined;
  private onImageError: (() => void) | undefined;
  private lastStatus: UserStatus | undefined;
  private replayingProperties = false;

  get person(): UserPerson | null { return this.currentPerson; }
  set person(value: UserPerson | null) { this.currentPerson = value; this.sync(); }
  get loading(): boolean { return this.getAttribute('loading') !== null && this.getAttribute('loading') !== 'false'; }
  set loading(value: boolean) { this.setAttribute('loading', String(Boolean(value))); }
  get error(): string | null { return this.hasAttribute('error') ? this.getAttribute('error') ?? '' : null; }
  set error(value: string | null) { if (value === null) this.removeAttribute('error'); else this.setAttribute('error', value); }
  get identityState(): UserIdentityState { const value = this.getAttribute('identity-state'); return isIdentityState(value) ? value : 'unknown'; }
  set identityState(value: UserIdentityState) { this.setAttribute('identity-state', value); }
  get size(): UserSize { const value = this.getAttribute('size'); return isSize(value) ? value : 'sm'; }
  set size(value: UserSize) { this.setAttribute('size', value); }
  get mode(): UserMode { const value = this.getAttribute('mode'); return isMode(value) ? value : 'user'; }
  set mode(value: UserMode) { this.setAttribute('mode', value); }
  get avatar(): boolean { return this.getAttribute('avatar') !== 'false'; }
  set avatar(value: boolean) { this.setAttribute('avatar', String(Boolean(value))); }
  get link(): boolean { return this.getAttribute('link') !== 'false'; }
  set link(value: boolean) { this.setAttribute('link', String(Boolean(value))); }
  get decorative(): boolean { return this.getAttribute('decorative') !== null && this.getAttribute('decorative') !== 'false'; }
  set decorative(value: boolean) { this.setAttribute('decorative', String(Boolean(value))); }
  get fallback(): string | undefined { return this.getAttribute('fallback') ?? undefined; }
  set fallback(value: string | undefined) { if (value === undefined) this.removeAttribute('fallback'); else this.setAttribute('fallback', value); }
  get profileHref(): string | undefined { return this.getAttribute('profile-href') ?? undefined; }
  set profileHref(value: string | undefined) { if (value === undefined) this.removeAttribute('profile-href'); else this.setAttribute('profile-href', value); }
  get status(): UserStatus { return this.loading ? 'loading' : this.error !== null ? 'error' : this.person ? 'person' : this.identityState; }

  connectedCallback(): void {
    this.replayingProperties = true;
    try { replayPreUpgradeProperties(this, ['person', 'loading', 'error', 'identityState', 'size', 'mode', 'avatar', 'link', 'decorative', 'fallback', 'profileHref']); }
    finally { this.replayingProperties = false; }
    if (!this.hasAttribute('data-slot')) this.setAttribute('data-slot', 'user');
    this.ensureView(); this.sync();
    if (this.nativeImage && !this.onImageLoad) this.bindImage();
  }
  disconnectedCallback(): void {
    this.unbindImage(); this.generation++;
  }
  attributeChangedCallback(): void { if (!this.replayingProperties) this.sync(); }

  private ensureView(): void {
    if (this.avatarBox && this.fallbackNode && this.labelNode) return;
    const view = this.ownerDocument.createElement('span'); view.setAttribute('data-slot', 'user-content');
    this.avatarBox = this.ownerDocument.createElement('span'); this.avatarBox.setAttribute('data-slot', 'avatar');
    this.fallbackNode = this.ownerDocument.createElement('span'); this.fallbackNode.setAttribute('data-slot', 'avatar-fallback');
    this.avatarBox.append(this.fallbackNode);
    this.labelNode = this.ownerDocument.createElement('span'); this.labelNode.setAttribute('data-slot', 'user-label');
    view.append(this.avatarBox, this.labelNode);
    this.prepend(view);
  }
  private unbindImage(): void {
    if (!this.nativeImage) return;
    if (this.onImageLoad) this.nativeImage.removeEventListener('load', this.onImageLoad);
    if (this.onImageError) this.nativeImage.removeEventListener('error', this.onImageError);
    this.onImageLoad = undefined; this.onImageError = undefined;
  }
  private bindImage(): void {
    const image = this.nativeImage;
    if (!image || !this.nativeImageSrc || !this.isConnected) return;
    this.unbindImage();
    const generation = this.generation;
    this.onImageLoad = () => {
      if (generation !== this.generation || this.nativeImage !== image || !this.isConnected) return;
      this.imageState = image.naturalWidth > 0 ? 'loaded' : 'error'; this.syncAvatar();
    };
    this.onImageError = () => {
      if (generation !== this.generation || this.nativeImage !== image || !this.isConnected) return;
      this.imageState = 'error'; this.syncAvatar();
    };
    image.addEventListener('load', this.onImageLoad); image.addEventListener('error', this.onImageError);
    if (image.complete) { this.imageState = image.naturalWidth > 0 ? 'loaded' : 'error'; this.syncAvatar(); }
  }
  private replaceImage(source: string | null): void {
    this.unbindImage(); this.generation++;
    const previous = this.nativeImage;
    if (previous && previous.parentNode === this.avatarBox) previous.remove();
    this.nativeImage = undefined; this.nativeImageSrc = source;
    this.imageState = source ? 'loading' : this.status === 'person' && this.person?.image ? 'error' : 'empty';
    if (!source || !this.avatarBox) return;
    const image = this.ownerDocument.createElement('img');
    image.setAttribute('data-slot', 'user-image'); image.alt = ''; image.setAttribute('aria-hidden', 'true'); image.hidden = true;
    this.nativeImage = image; this.avatarBox.append(image);
    image.setAttribute('src', source);
    this.bindImage();
  }
  private displayLabel(): string {
    if (this.status === 'loading') return 'Loading person';
    if (this.status === 'error') return this.error || 'Unable to load person';
    if (this.person) return this.person.handle ? `@${this.person.handle}` : this.person.name?.trim() || 'Unknown person';
    if (this.identityState === 'missing') return 'Person not found';
    if (this.identityState === 'deleted') return 'Deleted person';
    return this.fallback ?? 'Unknown person';
  }
  private fallbackOnly(): boolean { return !this.person && this.status === 'unknown' && this.fallback !== undefined; }
  private showsAvatar(): boolean { return !this.fallbackOnly() && (this.mode === 'avatar' || this.mode === 'user' && this.avatar); }
  private renderLabel(): void {
    const label = this.labelNode; if (!label) return;
    label.setAttribute('aria-live', 'polite');
    label.replaceChildren();
    const person = this.person;
    if (this.status === 'person' && person?.handle) {
      const candidate = this.profileHref ?? person.profileHref ?? `/@${encodeURIComponent(person.handle)}`;
      const href = this.link ? safeHref(candidate) : null;
      if (href) {
        const anchor = this.ownerDocument.createElement('a'); anchor.setAttribute('data-slot', 'user-profile-link');
        anchor.setAttribute('href', href); anchor.setAttribute('target', '_top'); anchor.setAttribute('rel', 'noopener');
        anchor.textContent = `@${person.handle}`; label.append(anchor); return;
      }
    }
    label.textContent = this.displayLabel();
  }
  private syncAvatar(): void {
    const box = this.avatarBox, initial = this.fallbackNode; if (!box || !initial) return;
    box.dataset.size = this.size; box.dataset.imageState = this.imageState;
    const person = this.status === 'person' ? this.person : null;
    initial.textContent = person?.name ? personInitial(person.name) : '?';
    initial.hidden = this.imageState === 'loaded';
    if (person?.id) { box.style.backgroundColor = personFaceBackground(person.id); initial.style.color = '#fff'; }
    else { box.style.removeProperty('background-color'); initial.style.removeProperty('color'); }
    box.hidden = !this.showsAvatar();
    if (this.decorative || this.mode === 'user') {
      box.removeAttribute('role'); box.removeAttribute('aria-label'); box.setAttribute('aria-hidden', 'true');
    } else {
      box.removeAttribute('aria-hidden'); box.setAttribute('role', 'img'); box.setAttribute('aria-label', person?.name?.trim() || this.displayLabel());
    }
    if (this.nativeImage) this.nativeImage.hidden = this.imageState !== 'loaded';
  }
  private sync(): void {
    if (!this.isConnected || this.replayingProperties) return;
    this.ensureView();
    const nextStatus = this.status;
    this.dataset.state = nextStatus;
    if (this.lastStatus !== undefined && this.lastStatus !== nextStatus) {
      this.dispatchEvent(new CustomEvent('af-user-state', { detail: { status: nextStatus }, bubbles: true, composed: true }));
    }
    this.lastStatus = nextStatus;
    const showAvatar = this.showsAvatar();
    const activePerson = this.status === 'person' && showAvatar ? this.person : null;
    const requestedImage = activePerson?.image?.trim() ?? '';
    const source = safeImageSource(requestedImage);
    const imageChanged = source !== this.nativeImageSrc;
    const invalidSourceNeedsError = !source && Boolean(requestedImage) && this.imageState !== 'error';
    const missingSourceNeedsReset = !source && !requestedImage && this.imageState !== 'empty';
    if (imageChanged || invalidSourceNeedsError || missingSourceNeedsReset) this.replaceImage(source);
    this.renderLabel(); this.syncAvatar();
    const label = this.labelNode;
    if (label) label.hidden = this.mode === 'avatar' && !this.fallbackOnly();
    if (this.avatarBox && this.mode === 'handle') this.avatarBox.hidden = true;
  }
}

const userStyles = `
af-user{box-sizing:border-box;display:inline-flex;align-items:center;gap:.375rem;vertical-align:middle;color:var(--foreground,#171717);font:inherit}
af-user>[data-slot=user-content]{display:inline-flex;align-items:center;gap:.375rem;min-width:0}
af-user [data-slot=avatar]{box-sizing:border-box;position:relative;display:inline-flex;flex:none;align-items:center;justify-content:center;width:1.25rem;height:1.25rem;overflow:hidden;border-radius:9999px;background:var(--muted,#f5f5f5);color:var(--muted-foreground,#737373);vertical-align:middle}
af-user [data-slot=avatar][hidden],af-user [data-slot=user-label][hidden]{display:none!important}
af-user [data-slot=avatar][data-size=md]{width:2rem;height:2rem}
af-user [data-slot=avatar][data-size=lg]{width:3rem;height:3rem}
af-user [data-slot=avatar-fallback]{display:flex;width:100%;height:100%;align-items:center;justify-content:center;border-radius:inherit;color:var(--muted-foreground,#737373);font-size:.625rem;line-height:1;font-weight:500;user-select:none}
af-user [data-size=md] [data-slot=avatar-fallback]{font-size:.75rem}
af-user [data-size=lg] [data-slot=avatar-fallback]{font-size:1rem}
af-user [data-slot=user-image]{position:absolute;inset:0;display:block;width:100%;height:100%;aspect-ratio:1;object-fit:cover}
af-user [data-slot=user-image][hidden]{display:none!important}
af-user [data-slot=user-label]{min-width:0}
af-user [data-slot=user-label] a{color:inherit;text-decoration-color:transparent;text-underline-offset:2px}
af-user [data-slot=user-label] a:hover{text-decoration-color:currentColor}
af-user[data-state=error] [data-slot=user-label],af-user[data-state=unknown] [data-slot=user-label],af-user[data-state=missing] [data-slot=user-label],af-user[data-state=deleted] [data-slot=user-label]{color:var(--muted-foreground,#737373)}
`;

export function registerUser(registry: CustomElementRegistry = customElements, document: Document = globalThis.document): void {
  if (!document.querySelector('style[data-af-user-styles]')) {
    const style = document.createElement('style'); style.setAttribute('data-af-user-styles', ''); style.textContent = userStyles; document.head.append(style);
  }
  if (!registry.get('af-user')) registry.define('af-user', AfUser);
}
