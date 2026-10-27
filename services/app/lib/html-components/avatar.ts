/**
 * <af-avatar>: image with a fallback.
 * Usage: import '@afbin/avatar';  (registers the tags; this .ts is the readable contract)
 * Props: size (sm|default|lg); status (read-only: idle|loading|loaded|error).
 *   Parts: af-avatar-image src alt, af-avatar-fallback, af-avatar-badge, af-avatar-group,
 *   af-avatar-group-count.
 * Examples:
 *   <af-avatar><af-avatar-image src="me.png" alt="Ada"></af-avatar-image>
 *   <af-avatar-fallback>A</af-avatar-fallback></af-avatar>
 * Gotchas: the fallback shows until the first af-avatar-image has loaded, and again if it fails;
 *   only the first image part of an avatar counts. Light DOM; the image renders a native <img>.
 */
import { registerComponent, type ComponentDescriptor } from './register-component';
import {
  avatarStyles, imagePartStatus, replayPreUpgradeProperties, type AvatarContract,
  type AvatarImageContract, type AvatarImageStatusDetail, type AvatarSize, type AvatarStatus,
} from './avatar-model';

export type { AvatarContract, AvatarImageContract, AvatarSize, AvatarStatus } from './avatar-model';

export class AfAvatar extends HTMLElement implements AvatarContract {
  static observedAttributes = ['size'];
  private currentStatus: AvatarStatus = 'idle';
  private primaryImage: AfAvatarImage | null = null;
  private observer = new MutationObserver(() => this.syncParts());
  get size(): AvatarSize {
    const size = this.getAttribute('size');
    return size === 'sm' || size === 'lg' ? size : 'default';
  }
  set size(value: AvatarSize) { this.setAttribute('size', value); }
  get status(): AvatarStatus { return this.currentStatus; }

  connectedCallback(): void {
    replayPreUpgradeProperties(this, ['size']);
    this.addEventListener('af-avatar-status', this.onStatus as EventListener);
    this.observer.observe(this, { childList: true, subtree: true });
    const image = this.images()[0];
    this.currentStatus = image ? imagePartStatus(image) : 'idle';
    this.syncParts();
  }
  disconnectedCallback(): void {
    this.observer.disconnect();
    this.removeEventListener('af-avatar-status', this.onStatus as EventListener);
  }
  attributeChangedCallback(): void { this.dataset.size = this.size; }

  // Own parts only; a nested avatar's parts belong to it.
  private images(): AfAvatarImage[] {
    return [...this.querySelectorAll<AfAvatarImage>('af-avatar-image')]
      .filter(image => image.closest('af-avatar') === this);
  }
  private fallbacks(): AfAvatarFallback[] {
    return [...this.querySelectorAll<AfAvatarFallback>('af-avatar-fallback')]
      .filter(part => part.closest('af-avatar') === this);
  }
  private onStatus = (event: CustomEvent<AvatarImageStatusDetail>): void => {
    const image = this.images()[0] ?? null;
    if (event.target !== image) return; // Only the first image drives the avatar.
    this.primaryImage = image;
    this.currentStatus = event.detail.status;
    this.syncParts();
  };
  private syncParts(): void {
    if (!this.isConnected) return;
    const image = this.images()[0] ?? null;
    if (image !== this.primaryImage) {
      this.primaryImage = image;
      this.currentStatus = image ? imagePartStatus(image) : 'idle';
    }
    this.dataset.size = this.size;
    this.dataset.state = this.currentStatus;
    for (const part of this.images()) part.hidden = this.currentStatus !== 'loaded';
    for (const fallback of this.fallbacks()) fallback.hidden = this.currentStatus === 'loaded';
  }
}

export class AfAvatarImage extends HTMLElement implements AvatarImageContract {
  static observedAttributes = ['src', 'alt'];
  private nativeImage: HTMLImageElement | undefined;
  private generation = 0; // Bumped per load so stale load/error callbacks are ignored.
  private replayingProperties = false;
  private onLoad: (() => void) | undefined;
  private onError: (() => void) | undefined;
  get src(): string | null { return this.getAttribute('src'); }
  set src(value: string | null) {
    if (value === null) this.removeAttribute('src'); else this.setAttribute('src', value);
  }
  get alt(): string { return this.getAttribute('alt') ?? ''; }
  set alt(value: string) { this.setAttribute('alt', value); }

  connectedCallback(): void {
    this.replayingProperties = true;
    try { replayPreUpgradeProperties(this, ['src', 'alt']); }
    finally { this.replayingProperties = false; }
    this.ensureSlot();
    this.loadSource(false);
  }
  disconnectedCallback(): void { this.unbind(); this.generation++; }
  attributeChangedCallback(name: string): void {
    if (!this.isConnected || this.replayingProperties) return;
    if (name === 'src') this.loadSource(true);
    else if (this.nativeImage) this.nativeImage.alt = this.alt;
  }

  private ensureSlot(): void {
    if (!this.hasAttribute('data-slot')) this.setAttribute('data-slot', 'avatar-image');
  }
  private unbind(): void {
    if (!this.nativeImage) return;
    if (this.onLoad) this.nativeImage.removeEventListener('load', this.onLoad);
    if (this.onError) this.nativeImage.removeEventListener('error', this.onError);
    this.onLoad = undefined; this.onError = undefined;
  }
  private emit(status: AvatarStatus, generation: number): void {
    if (this.dataset.state === status) return; // Only report changes.
    this.dataset.state = status;
    this.dispatchEvent(new CustomEvent<AvatarImageStatusDetail>('af-avatar-status', {
      detail: { status, generation }, bubbles: true, composed: true,
    }));
  }
  private loadSource(changed: boolean): void {
    const src = this.src;
    const generation = ++this.generation;
    this.unbind();
    if (!this.nativeImage || changed) {
      const oldImage = this.nativeImage;
      const image = this.ownerDocument.createElement('img');
      image.alt = this.alt;
      image.setAttribute('part', 'image');
      if (oldImage?.parentNode === this) oldImage.remove();
      this.nativeImage = image;
      this.append(image);
    }
    const image = this.nativeImage!;
    image.alt = this.alt;
    if (!src) { image.removeAttribute('src'); this.emit('error', generation); return; }
    const current = () => generation === this.generation && this.nativeImage === image;
    // A load without a natural width still counts as an error.
    this.onLoad = () => {
      if (current()) this.emit(image.naturalWidth > 0 ? 'loaded' : 'error', generation);
    };
    this.onError = () => { if (current()) this.emit('error', generation); };
    image.addEventListener('load', this.onLoad);
    image.addEventListener('error', this.onError);
    this.emit('loading', generation);
    if (changed || !image.hasAttribute('src')) image.setAttribute('src', src);
    // A cached image may be complete before the load event could be observed.
    if (image.complete) this.emit(image.naturalWidth > 0 ? 'loaded' : 'error', generation);
  }
}

class AfAvatarFallback extends HTMLElement {
  connectedCallback(): void {
    if (!this.hasAttribute('data-slot')) this.setAttribute('data-slot', 'avatar-fallback');
  }
}
class AfAvatarBadge extends HTMLElement {
  connectedCallback(): void {
    if (!this.hasAttribute('data-slot')) this.setAttribute('data-slot', 'avatar-badge');
  }
}
class AfAvatarGroup extends HTMLElement {
  connectedCallback(): void {
    if (!this.hasAttribute('data-slot')) this.setAttribute('data-slot', 'avatar-group');
  }
}
class AfAvatarGroupCount extends HTMLElement {
  connectedCallback(): void {
    if (!this.hasAttribute('data-slot')) this.setAttribute('data-slot', 'avatar-group-count');
  }
}

/** Registration descriptor (tags + stylesheet) applied on import; exported for tests. */
export const avatarComponent: ComponentDescriptor = {
  styleKey: 'af-avatar-styles',
  styles: avatarStyles,
  elements: {
    'af-avatar': AfAvatar,
    'af-avatar-image': AfAvatarImage,
    'af-avatar-fallback': AfAvatarFallback,
    'af-avatar-badge': AfAvatarBadge,
    'af-avatar-group': AfAvatarGroup,
    'af-avatar-group-count': AfAvatarGroupCount,
  },
};
registerComponent(avatarComponent);
