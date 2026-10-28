/**
 * <af-avatar>: image with a fallback.
 * Import:  import '@afbin/avatar';  (registers the tags; this .ts is the readable contract)
 * Props: size (sm|default|lg)
 * Parts: af-avatar-image src alt, af-avatar-fallback
 * Usage:
 *   <af-avatar><af-avatar-image src="me.png" alt="Ada"></af-avatar-image><af-avatar-fallback>A</af-avatar-fallback></af-avatar>
 */
import { registerComponent, type ComponentDescriptor } from './register-component';
export type AvatarSize = 'sm' | 'default' | 'lg';
export type AvatarStatus = 'idle' | 'loading' | 'loaded' | 'error';
export interface AvatarContract { size: AvatarSize; status: AvatarStatus }
export interface AvatarImageContract { src: string | null; alt: string }

interface AvatarImageStatusDetail { status: AvatarStatus; generation: number }

function replayPreUpgradeProperties(element: HTMLElement, names: readonly string[]): void {
  const properties = element as unknown as Record<string, unknown>;
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(element, name)) continue;
    const value = properties[name];
    delete properties[name];
    properties[name] = value;
  }
}

export class AfAvatar extends HTMLElement implements AvatarContract {
  static observedAttributes = ['size'];
  private currentStatus: AvatarStatus = 'idle';
  private primaryImage: AfAvatarImage | null = null;
  private observer = new MutationObserver(() => this.syncParts());
  get size(): AvatarSize { const size = this.getAttribute('size'); return size === 'sm' || size === 'lg' ? size : 'default'; }
  set size(value: AvatarSize) { this.setAttribute('size', value); }
  get status(): AvatarStatus { return this.currentStatus; }

  connectedCallback(): void {
    replayPreUpgradeProperties(this, ['size']);
    this.addEventListener('af-avatar-status', this.onStatus as EventListener);
    this.observer.observe(this, { childList: true, subtree: true });
    const image = this.images()[0];
    if (image) {
      const state = image.dataset.state;
      this.currentStatus = state === 'loading' || state === 'loaded' || state === 'error' ? state : image.hasAttribute('src') ? 'loading' : 'error';
    } else this.currentStatus = 'idle';
    this.syncParts();
  }
  disconnectedCallback(): void {
    this.observer.disconnect();
    this.removeEventListener('af-avatar-status', this.onStatus as EventListener);
  }
  attributeChangedCallback(): void { this.dataset.size = this.size; }

  private images(): AfAvatarImage[] { return [...this.querySelectorAll<AfAvatarImage>('af-avatar-image')].filter(image => image.closest('af-avatar') === this); }
  private fallbacks(): AfAvatarFallback[] { return [...this.querySelectorAll<AfAvatarFallback>('af-avatar-fallback')].filter(part => part.closest('af-avatar') === this); }
  private onStatus = (event: CustomEvent<AvatarImageStatusDetail>): void => {
    const image = this.images()[0] ?? null;
    if (event.target !== image) return;
    this.primaryImage = image;
    this.currentStatus = event.detail.status;
    this.syncParts();
  };
  private syncParts(): void {
    if (!this.isConnected) return;
    const image = this.images()[0] ?? null;
    if (image !== this.primaryImage) {
      this.primaryImage = image;
      const state = image?.dataset.state;
      this.currentStatus = image
        ? state === 'loading' || state === 'loaded' || state === 'error' ? state : image.hasAttribute('src') ? 'loading' : 'error'
        : 'idle';
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
  private generation = 0;
  private replayingProperties = false;
  private onLoad: (() => void) | undefined;
  private onError: (() => void) | undefined;
  get src(): string | null { return this.getAttribute('src'); }
  set src(value: string | null) { if (value === null) this.removeAttribute('src'); else this.setAttribute('src', value); }
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

  private ensureSlot(): void { if (!this.hasAttribute('data-slot')) this.setAttribute('data-slot', 'avatar-image'); }
  private unbind(): void {
    if (!this.nativeImage) return;
    if (this.onLoad) this.nativeImage.removeEventListener('load', this.onLoad);
    if (this.onError) this.nativeImage.removeEventListener('error', this.onError);
    this.onLoad = undefined; this.onError = undefined;
  }
  private emit(status: AvatarStatus, generation: number): void {
    if (this.dataset.state === status) return;
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
    this.onLoad = () => { if (generation === this.generation && this.nativeImage === image) this.emit(image.naturalWidth > 0 ? 'loaded' : 'error', generation); };
    this.onError = () => { if (generation === this.generation && this.nativeImage === image) this.emit('error', generation); };
    image.addEventListener('load', this.onLoad);
    image.addEventListener('error', this.onError);
    this.emit('loading', generation);
    if (changed || !image.hasAttribute('src')) image.setAttribute('src', src);
    if (image.complete) this.emit(image.naturalWidth > 0 ? 'loaded' : 'error', generation);
  }
}

class AfAvatarFallback extends HTMLElement {
  connectedCallback(): void { if (!this.hasAttribute('data-slot')) this.setAttribute('data-slot', 'avatar-fallback'); }
}
class AfAvatarBadge extends HTMLElement {
  connectedCallback(): void { if (!this.hasAttribute('data-slot')) this.setAttribute('data-slot', 'avatar-badge'); }
}
class AfAvatarGroup extends HTMLElement {
  connectedCallback(): void { if (!this.hasAttribute('data-slot')) this.setAttribute('data-slot', 'avatar-group'); }
}
class AfAvatarGroupCount extends HTMLElement {
  connectedCallback(): void { if (!this.hasAttribute('data-slot')) this.setAttribute('data-slot', 'avatar-group-count'); }
}

const avatarStyles = `
af-avatar{box-sizing:border-box;position:relative;display:inline-flex;flex:none;align-items:center;justify-content:center;width:2rem;height:2rem;overflow:hidden;border-radius:9999px;background:var(--muted,#f5f5f5);color:var(--muted-foreground,#737373);vertical-align:middle;isolation:isolate}
af-avatar[data-size=sm]{width:1.5rem;height:1.5rem}
af-avatar[data-size=lg]{width:2.5rem;height:2.5rem}
af-avatar-image{position:absolute;inset:0;display:block;width:100%;height:100%;aspect-ratio:1}
af-avatar-image[hidden],af-avatar-fallback[hidden]{display:none!important}
af-avatar-image>img{display:block;width:100%;height:100%;aspect-ratio:1;object-fit:cover}
af-avatar-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:inherit;background:var(--muted,#f5f5f5);color:var(--muted-foreground,#737373);font-size:.875rem;line-height:1;user-select:none}
af-avatar[data-size=sm]>af-avatar-fallback{font-size:.75rem}
af-avatar-badge{position:absolute;right:0;bottom:0;z-index:10;display:inline-flex;align-items:center;justify-content:center;width:.625rem;height:.625rem;overflow:visible;border-radius:9999px;background:var(--primary,#171717);color:var(--primary-foreground,#fff);box-shadow:0 0 0 2px var(--background,#fff);user-select:none}
af-avatar[data-size=sm]>af-avatar-badge{width:.5rem;height:.5rem}
af-avatar[data-size=lg]>af-avatar-badge{width:.75rem;height:.75rem}
af-avatar-badge>svg{width:.5rem;height:.5rem;flex:none}
af-avatar-group{display:flex;align-items:flex-start}
af-avatar-group>af-avatar,af-avatar-group>af-avatar-group-count{box-shadow:0 0 0 2px var(--background,#fff)}
af-avatar-group>af-avatar~af-avatar,af-avatar-group>af-avatar-group-count{margin-inline-start:-.5rem}
af-avatar-group-count{position:relative;display:inline-flex;flex:none;align-items:center;justify-content:center;width:2rem;height:2rem;border-radius:9999px;background:var(--muted,#f5f5f5);color:var(--muted-foreground,#737373);font-size:.875rem;line-height:1}
af-avatar-group:has(af-avatar[data-size=lg])>af-avatar-group-count{width:2.5rem;height:2.5rem}
af-avatar-group:has(af-avatar[data-size=sm])>af-avatar-group-count{width:1.5rem;height:1.5rem;font-size:.75rem}
af-avatar-group-count>svg{width:1rem;height:1rem}
`;

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
