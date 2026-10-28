/**
 * Internal: af-user types, attribute guards, URL safety checks, pre-upgrade replay and CSS.
 * Used by: user.ts.
 */
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
export type UserImageState = 'empty' | 'loading' | 'loaded' | 'error';

/** Boolean attribute that is on unless absent or literally "false". */
export const isOn = (value: string | null): boolean => value !== null && value !== 'false';
export const isSize = (value: string | null): value is UserSize =>
  value === 'sm' || value === 'md' || value === 'lg';
export const isMode = (value: string | null): value is UserMode =>
  value === 'user' || value === 'avatar' || value === 'handle';
export const isIdentityState = (value: string | null): value is UserIdentityState =>
  value === 'unknown' || value === 'missing' || value === 'deleted';
// Attribute readers: an unknown value falls back to the default.
export const sizeOf = (value: string | null): UserSize => isSize(value) ? value : 'sm';
export const modeOf = (value: string | null): UserMode => isMode(value) ? value : 'user';
export const identityStateOf = (value: string | null): UserIdentityState =>
  isIdentityState(value) ? value : 'unknown';
/** Sets the attribute, or removes it when `remove` is true (the caller's own absent value). */
export function setOrRemove(element: Element, name: string, value: string | null | undefined,
  remove: boolean): void {
  if (remove) element.removeAttribute(name); else element.setAttribute(name, value as string);
}

/** Returns the href only if it is http(s) without credentials or a same-origin relative path. */
export function safeHref(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  // Backslashes and protocol-relative URLs can escape to another origin in some parsers.
  if (!candidate || candidate.includes('\\') || candidate.startsWith('//')) return null;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate);
      return (url.protocol === 'http:' || url.protocol === 'https:') &&
        !url.username && !url.password ? candidate : null;
    } catch { return null; }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(candidate)) return null; // javascript:, data:, etc.
  try {
    const url = new URL(candidate, 'https://pagegi.invalid');
    return url.origin === 'https://pagegi.invalid' ? candidate : null;
  } catch { return null; }
}

export function safeImageSource(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return safeHref(value);
}

/** Visible label text for a card that is not showing a profile link. */
export function userLabel(status: UserStatus, error: string | null, person: UserPerson | null,
  identityState: UserIdentityState, fallback: string | undefined): string {
  if (status === 'loading') return 'Loading person';
  if (status === 'error') return error || 'Unable to load person';
  if (person) return person.handle ? `@${person.handle}` : person.name?.trim() || 'Unknown person';
  if (identityState === 'missing') return 'Person not found';
  if (identityState === 'deleted') return 'Deleted person';
  return fallback ?? 'Unknown person';
}

export function slotSpan(document: Document, name: string): HTMLElement {
  const node = document.createElement('span'); node.setAttribute('data-slot', name);
  return node;
}

export function profileLink(document: Document, href: string, handle: string): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.setAttribute('data-slot', 'user-profile-link');
  anchor.setAttribute('href', href); anchor.setAttribute('target', '_top');
  anchor.setAttribute('rel', 'noopener');
  anchor.textContent = `@${handle}`;
  return anchor;
}

export interface AvatarPaint {
  size: UserSize; imageState: UserImageState; person: UserPerson | null; shown: boolean;
  decorative: boolean; mode: UserMode; label: string;
  initial: string; background: string | null;
}
/** Writes size, initials, face colour, visibility and ARIA onto the avatar box. */
export function paintAvatar(box: HTMLElement, initial: HTMLElement, paint: AvatarPaint): void {
  box.dataset.size = paint.size; box.dataset.imageState = paint.imageState;
  initial.textContent = paint.initial;
  initial.hidden = paint.imageState === 'loaded';
  if (paint.background !== null) {
    box.style.backgroundColor = paint.background; initial.style.color = '#fff';
  } else { box.style.removeProperty('background-color'); initial.style.removeProperty('color'); }
  box.hidden = !paint.shown;
  // In user mode the label already names the person, so the avatar is decorative.
  if (paint.decorative || paint.mode === 'user') {
    box.removeAttribute('role'); box.removeAttribute('aria-label');
    box.setAttribute('aria-hidden', 'true');
  } else {
    box.removeAttribute('aria-hidden'); box.setAttribute('role', 'img');
    box.setAttribute('aria-label', paint.person?.name?.trim() || paint.label);
  }
}

/** Whether the <img> must be rebuilt: a new safe source, an unsafe one not yet shown as an error,
 * or a cleared source that still shows a previous state. */
export function imageNeedsReplace(source: string | null, requested: string,
  current: string | null, state: UserImageState): boolean {
  const invalidSourceNeedsError = !source && Boolean(requested) && state !== 'error';
  const missingSourceNeedsReset = !source && !requested && state !== 'empty';
  return source !== current || invalidSourceNeedsError || missingSourceNeedsReset;
}

/** Re-applies properties set before the element upgraded so they run through the setters. */
export function replayPreUpgradeProperties(element: HTMLElement, names: readonly string[]): void {
  const properties = element as unknown as Record<string, unknown>;
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(element, name)) continue;
    const value = properties[name]; delete properties[name]; properties[name] = value;
  }
}

export const userStyles = `
af-user{box-sizing:border-box;display:inline-flex;align-items:center;gap:.375rem;\
vertical-align:middle;color:var(--foreground,#171717);font:inherit}
af-user>[data-slot=user-content]{display:inline-flex;align-items:center;gap:.375rem;min-width:0}
af-user [data-slot=avatar]{box-sizing:border-box;position:relative;display:inline-flex;flex:none;\
align-items:center;justify-content:center;width:1.25rem;height:1.25rem;overflow:hidden;\
border-radius:9999px;background:var(--muted,#f5f5f5);color:var(--muted-foreground,#737373);\
vertical-align:middle}
af-user [data-slot=avatar][hidden],af-user [data-slot=user-label][hidden]{display:none!important}
af-user [data-slot=avatar][data-size=md]{width:2rem;height:2rem}
af-user [data-slot=avatar][data-size=lg]{width:3rem;height:3rem}
af-user [data-slot=avatar-fallback]{display:flex;width:100%;height:100%;align-items:center;\
justify-content:center;border-radius:inherit;color:var(--muted-foreground,#737373);\
font-size:.625rem;line-height:1;font-weight:500;user-select:none}
af-user [data-size=md] [data-slot=avatar-fallback]{font-size:.75rem}
af-user [data-size=lg] [data-slot=avatar-fallback]{font-size:1rem}
af-user [data-slot=user-image]{position:absolute;inset:0;display:block;width:100%;height:100%;\
aspect-ratio:1;object-fit:cover}
af-user [data-slot=user-image][hidden]{display:none!important}
af-user [data-slot=user-label]{min-width:0}
af-user [data-slot=user-label] a{color:inherit;text-decoration-color:transparent;\
text-underline-offset:2px}
af-user [data-slot=user-label] a:hover{text-decoration-color:currentColor}
af-user[data-state=error] [data-slot=user-label],\
af-user[data-state=unknown] [data-slot=user-label],\
af-user[data-state=missing] [data-slot=user-label],\
af-user[data-state=deleted] [data-slot=user-label]{color:var(--muted-foreground,#737373)}
`;
