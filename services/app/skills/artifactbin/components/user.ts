/**
 * <af-user>: person card; the app supplies identity (no account lookup happens in the element).
 * Usage: import '@afbin/user';  (registers the tags; this .ts is the readable contract)
 * Props: person={id,name,handle,image,profileHref}, loading, error, identityState /
 *   identity-state (unknown|missing|deleted), mode (user|avatar|handle), size (sm|md|lg),
 *   avatar, link, decorative, fallback, profileHref / profile-href.
 * Events: af-user-state (bubbles) with event.detail.status when the status changes.
 * Examples:
 *   element.person={id:"u1",name:"Ada",handle:"ada",image:null,profileHref:"/u/ada"};
 *   Resolve a User ID from a linked dataset's typed user column by querying that namespace:
 *   const {data}=await client.query({query:gql`query($ids:[ID!]!){bookings{
 *     people(ids:$ids){id name handle image}}}`,variables:{ids:[userId]}});
 *   element.person=data.bookings.people.find(p=>p.id===userId)??null;
 * Gotchas: only IDs present in that dataset's typed user columns resolve (at most 100 per
 *   request; dataset read permission is checked before and after). Offline preview cannot
 *   resolve account cards. Keep an absent card null; never invent a name from the ID.
 */
import { registerComponent, type ComponentDescriptor } from './register-component';
import { personFaceBackground, personInitial } from '../islands';
import {
  identityStateOf, imageNeedsReplace, isOn, modeOf, paintAvatar, profileLink,
  replayPreUpgradeProperties, safeHref, safeImageSource, setOrRemove, sizeOf, slotSpan,
  userLabel, userStyles, type UserContract, type UserIdentityState, type UserImageState,
  type UserMode, type UserPerson, type UserSize, type UserStatus } from './user-model';

export type { UserContract, UserIdentityState, UserMode, UserPerson, UserSize, UserStatus }
  from './user-model';

export class AfUser extends HTMLElement implements UserContract {
  static observedAttributes = ['loading', 'error', 'identity-state', 'size', 'mode', 'avatar',
    'link', 'decorative', 'fallback', 'profile-href'];
  private currentPerson: UserPerson | null = null;
  private avatarBox: HTMLElement | undefined;
  private fallbackNode: HTMLElement | undefined;
  private labelNode: HTMLElement | undefined;
  private nativeImage: HTMLImageElement | undefined;
  private nativeImageSrc: string | null = null;
  private imageState: UserImageState = 'empty';
  // Bumped whenever the image is replaced or detached; see bindImage.
  private generation = 0;
  private onImageLoad: (() => void) | undefined;
  private onImageError: (() => void) | undefined;
  private lastStatus: UserStatus | undefined;
  private replayingProperties = false;
  get person(): UserPerson | null { return this.currentPerson; }
  set person(value: UserPerson | null) { this.currentPerson = value; this.sync(); }
  get loading(): boolean { return isOn(this.getAttribute('loading')); }
  set loading(value: boolean) { this.setAttribute('loading', String(Boolean(value))); }
  get error(): string | null {
    return this.hasAttribute('error') ? this.getAttribute('error') ?? '' : null; }
  set error(value: string | null) { setOrRemove(this, 'error', value, value === null); }
  get identityState(): UserIdentityState {
    return identityStateOf(this.getAttribute('identity-state')); }
  set identityState(value: UserIdentityState) { this.setAttribute('identity-state', value); }
  get size(): UserSize { return sizeOf(this.getAttribute('size')); }
  set size(value: UserSize) { this.setAttribute('size', value); }
  get mode(): UserMode { return modeOf(this.getAttribute('mode')); }
  set mode(value: UserMode) { this.setAttribute('mode', value); }
  get avatar(): boolean { return this.getAttribute('avatar') !== 'false'; }
  set avatar(value: boolean) { this.setAttribute('avatar', String(Boolean(value))); }
  get link(): boolean { return this.getAttribute('link') !== 'false'; }
  set link(value: boolean) { this.setAttribute('link', String(Boolean(value))); }
  get decorative(): boolean { return isOn(this.getAttribute('decorative')); }
  set decorative(value: boolean) { this.setAttribute('decorative', String(Boolean(value))); }
  get fallback(): string | undefined { return this.getAttribute('fallback') ?? undefined; }
  set fallback(value: string | undefined) {
    setOrRemove(this, 'fallback', value, value === undefined); }
  get profileHref(): string | undefined { return this.getAttribute('profile-href') ?? undefined; }
  set profileHref(value: string | undefined) {
    setOrRemove(this, 'profile-href', value, value === undefined); }
  get status(): UserStatus {
    return this.loading ? 'loading' : this.error !== null ? 'error' :
      this.person ? 'person' : this.identityState;
  }

  connectedCallback(): void {
    this.replayingProperties = true;
    try {
      replayPreUpgradeProperties(this, ['person', 'loading', 'error', 'identityState', 'size',
        'mode', 'avatar', 'link', 'decorative', 'fallback', 'profileHref']);
    } finally { this.replayingProperties = false; }
    if (!this.hasAttribute('data-slot')) this.setAttribute('data-slot', 'user');
    this.ensureView(); this.sync();
    if (this.nativeImage && !this.onImageLoad) this.bindImage();
  }
  disconnectedCallback(): void { this.unbindImage(); this.generation++; }
  attributeChangedCallback(): void { if (!this.replayingProperties) this.sync(); }
  private ensureView(): void {
    if (this.avatarBox && this.fallbackNode && this.labelNode) return;
    const slot = (name: string): HTMLElement => slotSpan(this.ownerDocument, name);
    const view = slot('user-content');
    this.avatarBox = slot('avatar');
    this.fallbackNode = slot('avatar-fallback');
    this.avatarBox.append(this.fallbackNode);
    this.labelNode = slot('user-label');
    view.append(this.avatarBox, this.labelNode);
    this.prepend(view); // Authored children stay after the generated view.
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
    // Ignore callbacks from an image that was replaced, or after the element left the page.
    const settle = (state: UserImageState): void => {
      if (generation !== this.generation || this.nativeImage !== image || !this.isConnected) return;
      this.imageState = state; this.syncAvatar();
    };
    this.onImageLoad = () => settle(image.naturalWidth > 0 ? 'loaded' : 'error');
    this.onImageError = () => settle('error');
    image.addEventListener('load', this.onImageLoad);
    image.addEventListener('error', this.onImageError);
    // A cached image may already be complete before the listeners were attached.
    if (image.complete) settle(image.naturalWidth > 0 ? 'loaded' : 'error');
  }
  private replaceImage(source: string | null): void {
    this.unbindImage(); this.generation++;
    const previous = this.nativeImage;
    if (previous && previous.parentNode === this.avatarBox) previous.remove();
    this.nativeImage = undefined; this.nativeImageSrc = source;
    // A person image that failed the URL safety check shows as an error, not as empty.
    this.imageState = source ? 'loading' :
      this.status === 'person' && this.person?.image ? 'error' : 'empty';
    if (!source || !this.avatarBox) return;
    const image = this.ownerDocument.createElement('img');
    image.setAttribute('data-slot', 'user-image'); image.alt = '';
    image.setAttribute('aria-hidden', 'true'); image.hidden = true;
    this.nativeImage = image; this.avatarBox.append(image);
    image.setAttribute('src', source);
    this.bindImage();
  }
  private displayLabel(): string {
    return userLabel(this.status, this.error, this.person, this.identityState, this.fallback); }
  // A bare fallback text (unknown identity, no person) renders without an avatar.
  private fallbackOnly(): boolean {
    return !this.person && this.status === 'unknown' && this.fallback !== undefined; }
  private showsAvatar(): boolean {
    return !this.fallbackOnly() &&
      (this.mode === 'avatar' || this.mode === 'user' && this.avatar); }
  private renderLabel(): void {
    const label = this.labelNode; if (!label) return;
    label.setAttribute('aria-live', 'polite');
    label.replaceChildren();
    const person = this.person;
    if (this.status === 'person' && person?.handle) {
      const candidate = this.profileHref ?? person.profileHref ??
        `/@${encodeURIComponent(person.handle)}`;
      const href = this.link ? safeHref(candidate) : null;
      if (href) { label.append(profileLink(this.ownerDocument, href, person.handle)); return; }
    }
    label.textContent = this.displayLabel();
  }
  private syncAvatar(): void {
    const box = this.avatarBox, initial = this.fallbackNode; if (!box || !initial) return;
    const person = this.status === 'person' ? this.person : null;
    paintAvatar(box, initial, {
      size: this.size, imageState: this.imageState, person, shown: this.showsAvatar(),
      decorative: this.decorative, mode: this.mode, label: this.displayLabel(),
      initial: person?.name ? personInitial(person.name) : '?',
      background: person?.id ? personFaceBackground(person.id) : null,
    });
    if (this.nativeImage) this.nativeImage.hidden = this.imageState !== 'loaded';
  }
  private sync(): void {
    if (!this.isConnected || this.replayingProperties) return;
    this.ensureView();
    const nextStatus = this.status;
    this.dataset.state = nextStatus;
    if (this.lastStatus !== undefined && this.lastStatus !== nextStatus) {
      this.dispatchEvent(new CustomEvent('af-user-state',
        { detail: { status: nextStatus }, bubbles: true, composed: true }));
    }
    this.lastStatus = nextStatus;
    const showAvatar = this.showsAvatar();
    const activePerson = this.status === 'person' && showAvatar ? this.person : null;
    const requestedImage = activePerson?.image?.trim() ?? '';
    const source = safeImageSource(requestedImage);
    if (imageNeedsReplace(source, requestedImage, this.nativeImageSrc, this.imageState))
      this.replaceImage(source);
    this.renderLabel(); this.syncAvatar();
    const label = this.labelNode;
    if (label) label.hidden = this.mode === 'avatar' && !this.fallbackOnly();
    if (this.avatarBox && this.mode === 'handle') this.avatarBox.hidden = true;
  }
}

/** Registration descriptor (tags + stylesheet) applied on import; exported for tests. */
export const userComponent: ComponentDescriptor = {
  styleKey: 'af-user-styles', styles: userStyles,
  elements: { 'af-user': AfUser },
};
registerComponent(userComponent);
