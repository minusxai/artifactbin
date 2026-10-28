/**
 * Internal: af-avatar status types, image status derivation, pre-upgrade replay and CSS.
 * Used by: avatar.ts.
 */
export type AvatarSize = 'sm' | 'default' | 'lg';
export type AvatarStatus = 'idle' | 'loading' | 'loaded' | 'error';
export interface AvatarContract { size: AvatarSize; status: AvatarStatus }
export interface AvatarImageContract { src: string | null; alt: string }
/** Detail of the internal af-avatar-status event an image sends to its avatar. */
export interface AvatarImageStatusDetail { status: AvatarStatus; generation: number }

/** Status of an image part: its last reported state, else loading if it has a src, else error. */
export function imagePartStatus(image: HTMLElement): AvatarStatus {
  const state = image.dataset.state;
  return state === 'loading' || state === 'loaded' || state === 'error' ? state :
    image.hasAttribute('src') ? 'loading' : 'error';
}

/** Re-applies properties set before the element upgraded so they run through the setters. */
export function replayPreUpgradeProperties(element: HTMLElement, names: readonly string[]): void {
  const properties = element as unknown as Record<string, unknown>;
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(element, name)) continue;
    const value = properties[name];
    delete properties[name];
    properties[name] = value;
  }
}

export const avatarStyles = `
af-avatar{box-sizing:border-box;position:relative;display:inline-flex;flex:none;align-items:center;\
justify-content:center;width:2rem;height:2rem;overflow:hidden;border-radius:9999px;\
background:var(--muted,#f5f5f5);color:var(--muted-foreground,#737373);vertical-align:middle;\
isolation:isolate}
af-avatar[data-size=sm]{width:1.5rem;height:1.5rem}
af-avatar[data-size=lg]{width:2.5rem;height:2.5rem}
af-avatar-image{position:absolute;inset:0;display:block;width:100%;height:100%;aspect-ratio:1}
af-avatar-image[hidden],af-avatar-fallback[hidden]{display:none!important}
af-avatar-image>img{display:block;width:100%;height:100%;aspect-ratio:1;object-fit:cover}
af-avatar-fallback{position:absolute;inset:0;display:flex;align-items:center;\
justify-content:center;width:100%;height:100%;border-radius:inherit;background:var(--muted,\
#f5f5f5);color:var(--muted-foreground,#737373);font-size:.875rem;line-height:1;user-select:none}
af-avatar[data-size=sm]>af-avatar-fallback{font-size:.75rem}
af-avatar-badge{position:absolute;right:0;bottom:0;z-index:10;display:inline-flex;\
align-items:center;justify-content:center;width:.625rem;height:.625rem;overflow:visible;\
border-radius:9999px;background:var(--primary,#171717);color:var(--primary-foreground,#fff);\
box-shadow:0 0 0 2px var(--background,#fff);user-select:none}
af-avatar[data-size=sm]>af-avatar-badge{width:.5rem;height:.5rem}
af-avatar[data-size=lg]>af-avatar-badge{width:.75rem;height:.75rem}
af-avatar-badge>svg{width:.5rem;height:.5rem;flex:none}
af-avatar-group{display:flex;align-items:flex-start}
af-avatar-group>af-avatar,af-avatar-group>af-avatar-group-count{\
box-shadow:0 0 0 2px var(--background,#fff)}
af-avatar-group>af-avatar~af-avatar,af-avatar-group>af-avatar-group-count{\
margin-inline-start:-.5rem}
af-avatar-group-count{position:relative;display:inline-flex;flex:none;align-items:center;\
justify-content:center;width:2rem;height:2rem;border-radius:9999px;background:var(--muted,#f5f5f5);\
color:var(--muted-foreground,#737373);font-size:.875rem;line-height:1}
af-avatar-group:has(af-avatar[data-size=lg])>af-avatar-group-count{width:2.5rem;height:2.5rem}
af-avatar-group:has(af-avatar[data-size=sm])>af-avatar-group-count{width:1.5rem;height:1.5rem;\
font-size:.75rem}
af-avatar-group-count>svg{width:1rem;height:1rem}
`;
