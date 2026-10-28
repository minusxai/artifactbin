// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AfUser, UserPerson, UserStatus } from './user';
import { registerComponent } from './register-component';

const ada: UserPerson = { id: 'usr_ada', name: 'Ada Lovelace', handle: 'ada', image: '/ada.png' };
const preUpgradeHost = document.createElement('div');
preUpgradeHost.innerHTML = '<af-user fallback="Guest"><span data-af-id="authored">extra</span></af-user>';
const preUpgrade = preUpgradeHost.firstElementChild as AfUser;
Object.defineProperty(preUpgrade, 'person', { value: ada, writable: true, configurable: true });
Object.defineProperty(preUpgrade, 'size', { value: 'lg', writable: true, configurable: true });
Object.defineProperty(preUpgrade, 'mode', { value: 'avatar', writable: true, configurable: true });
Object.defineProperty(preUpgrade, 'link', { value: false, writable: true, configurable: true });
Object.defineProperty(preUpgrade, 'loading', { value: false, writable: true, configurable: true });
const { AfUser: AfUserClass, userComponent } = await import('./user');
afterEach(() => document.body.replaceChildren());

const status = (user: AfUser): UserStatus => user.status;
function mount() {
  const user = document.createElement('af-user') as AfUser;
  document.body.append(user);
  return user;
}
function portrait(user: AfUser): HTMLImageElement { return user.querySelector('img[data-slot="user-image"]') as HTMLImageElement; }
function setNaturalWidth(image: HTMLImageElement, width = 64): void { Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width }); }

describe('native light-DOM af-user', () => {
  it('renders a resolved person with deterministic initials, native image semantics, and a profile link', () => {
    const user = mount(); user.person = ada;
    const avatar = user.querySelector('[data-slot="avatar"]') as HTMLElement;
    const image = portrait(user);
    expect(status(user)).toBe('person'); expect(user.querySelector('[data-slot="user-label"]')?.textContent).toBe('@ada');
    expect(user.querySelector('[data-slot="user-label"] a')?.getAttribute('href')).toBe('/@ada');
    expect(avatar.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe('A');
    expect(image).toBeInstanceOf(HTMLImageElement); expect(image.getAttribute('src')).toBe('/ada.png');
    expect(image.alt).toBe(''); expect(image.getAttribute('aria-hidden')).toBe('true');
    expect(avatar.getAttribute('aria-hidden')).toBe('true');
    expect(avatar.style.backgroundColor).not.toBe('');
    setNaturalWidth(image); image.dispatchEvent(new Event('load'));
    expect(image.hidden).toBe(false); expect(avatar.querySelector('[data-slot="avatar-fallback"]')?.hasAttribute('hidden')).toBe(true);
  });

  it('shows initials after image errors and ignores stale load/error events after a source change', () => {
    const user = mount(); user.person = ada;
    const avatar = user.querySelector('[data-slot="avatar"]') as HTMLElement;
    const old = portrait(user);
    old.dispatchEvent(new Event('error'));
    expect(avatar.querySelector('[data-slot="avatar-fallback"]')?.hasAttribute('hidden')).toBe(false);
    user.person = { ...ada, image: '/new.png' };
    const current = portrait(user);
    expect(current).not.toBe(old); expect(current.getAttribute('src')).toBe('/new.png');
    old.dispatchEvent(new Event('load'));
    expect(current.hidden).toBe(true); expect(avatar.dataset.imageState).toBe('loading');
    setNaturalWidth(current); current.dispatchEvent(new Event('load'));
    expect(current.hidden).toBe(false); expect(avatar.dataset.imageState).toBe('loaded');
  });

  it('distinguishes loading, error, unknown, missing, and deleted without inventing a person', () => {
    const user = mount(); user.person = ada;
    user.loading = true;
    expect(status(user)).toBe('loading'); expect(user.textContent).toContain('Loading person');
    expect(user.querySelector('[data-slot="user-label"] a')).toBeNull();
    expect(user.querySelector('img[data-slot="user-image"]')).toBeNull();
    user.loading = false; expect(status(user)).toBe('person');
    user.error = 'Directory unavailable';
    expect(status(user)).toBe('error'); expect(user.textContent).toContain('Directory unavailable');
    user.error = null; user.person = null;
    expect(status(user)).toBe('unknown'); expect(user.textContent).toContain('Unknown person');
    user.identityState = 'missing'; expect(status(user)).toBe('missing'); expect(user.textContent).toContain('Person not found');
    user.identityState = 'deleted'; expect(status(user)).toBe('deleted'); expect(user.textContent).toContain('Deleted person');
    expect(user.querySelector('[data-slot="user-label"] a')).toBeNull();
    expect(user.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe('?');
  });

  it('supports old avatar/handle modes, sizes, link choice, and explicit fallback', () => {
    const user = mount(); user.person = { ...ada, image: null, handle: null };
    expect(user.querySelector('[data-slot="avatar"]')).not.toBeNull();
    expect(user.querySelector('[data-slot="user-label"]')?.textContent).toBe('Ada Lovelace');
    user.link = false; user.size = 'lg';
    expect((user.querySelector('[data-slot="avatar"]') as HTMLElement).dataset.size).toBe('lg');
    expect(user.querySelector('[data-slot="user-label"] a')).toBeNull();
    user.mode = 'handle'; expect((user.querySelector('[data-slot="avatar"]') as HTMLElement).hidden).toBe(true);
    user.mode = 'avatar'; expect((user.querySelector('[data-slot="user-label"]') as HTMLElement).hidden).toBe(true);
    expect((user.querySelector('[data-slot="avatar"]') as HTMLElement).getAttribute('aria-label')).toBe('Ada Lovelace');
    user.person = null; user.mode = 'user'; user.identityState = 'unknown'; user.fallback = 'No account';
    expect(user.querySelector('[data-slot="user-label"]')?.textContent).toBe('No account');
    user.mode = 'avatar';
    expect((user.querySelector('[data-slot="avatar"]') as HTMLElement).hidden).toBe(true);
    expect((user.querySelector('[data-slot="user-label"]') as HTMLElement).hidden).toBe(false);
    user.avatar = false; expect((user.querySelector('[data-slot="avatar"]') as HTMLElement).hidden).toBe(true);
  });

  it('does not request a profile image in handle-only mode or when the avatar is disabled', () => {
    const user = mount(); user.person = ada; user.avatar = false;
    expect(user.querySelector('img[data-slot="user-image"]')).toBeNull();
    user.avatar = true; user.mode = 'handle';
    expect(user.querySelector('img[data-slot="user-image"]')).toBeNull();
  });

  it('only links safe HTTP(S) or relative profile hrefs', () => {
    const user = mount(); user.person = { ...ada, profileHref: 'javascript:alert(1)' };
    expect(user.querySelector('[data-slot="user-label"] a')).toBeNull();
    user.person = { ...ada, profileHref: '//evil.example/path' };
    expect(user.querySelector('[data-slot="user-label"] a')).toBeNull();
    user.person = { ...ada, profileHref: 'https://profiles.example/ada' };
    expect(user.querySelector('[data-slot="user-label"] a')?.getAttribute('href')).toBe('https://profiles.example/ada');
    user.person = { ...ada, profileHref: '../people/ada' };
    expect(user.querySelector('[data-slot="user-label"] a')?.getAttribute('href')).toBe('../people/ada');
    user.person = { ...ada, image: 'javascript:alert(1)' };
    expect(user.querySelector('img[data-slot="user-image"]')).toBeNull();
    expect((user.querySelector('[data-slot="avatar"]') as HTMLElement).dataset.imageState).toBe('error');
  });

  it('replays pre-upgrade properties, retains keyed authored children, and reconnects without duplicate events', () => {
    document.body.append(preUpgradeHost);
    const authored = preUpgrade.querySelector('[data-af-id="authored"]');
    expect(status(preUpgrade)).toBe('person'); expect(preUpgrade.size).toBe('lg');
    expect(preUpgrade.mode).toBe('avatar'); expect(preUpgrade.link).toBe(false);
    expect(portrait(preUpgrade).getAttribute('src')).toBe('/ada.png');
    expect((preUpgrade.querySelector('[data-slot="avatar"]') as HTMLElement).getAttribute('aria-label')).toBe('Ada Lovelace');
    expect((preUpgrade.querySelector('[data-slot="user-label"]') as HTMLElement).hidden).toBe(true);
    expect(preUpgrade.querySelector('[data-af-id="authored"]')).toBe(authored);
    let count = 0; preUpgrade.addEventListener('af-user-state', () => count++);
    preUpgrade.loading = true; expect(count).toBe(1);
    preUpgrade.remove(); document.body.append(preUpgrade);
    preUpgrade.loading = false; expect(count).toBe(2);
    preUpgrade.person = { ...ada, image: '/next.png' };
    expect(preUpgrade.querySelector('[data-af-id="authored"]')).toBe(authored);
    expect(count).toBe(2);
  });

  it('reattaches native image listeners after reconnect without replacing authored children', () => {
    const user = mount(); user.person = ada;
    const authored = document.createElement('span'); authored.dataset.afId = 'retained'; user.append(authored);
    const image = portrait(user);
    user.remove(); document.body.append(user);
    expect(portrait(user)).toBe(image); expect(user.querySelector('[data-af-id="retained"]')).toBe(authored);
    setNaturalWidth(image); image.dispatchEvent(new Event('load'));
    expect(image.hidden).toBe(false);
    expect((user.querySelector('[data-slot="avatar"]') as HTMLElement).dataset.imageState).toBe('loaded');
  });

  it('uses a cached native image immediately without an app fetch or separate image probe', () => {
    const originalCreate = document.createElement.bind(document);
    const create = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreate(tagName, options);
      if (tagName.toLowerCase() === 'img') {
        Object.defineProperty(element, 'complete', { configurable: true, value: true });
        Object.defineProperty(element, 'naturalWidth', { configurable: true, value: 72 });
      }
      return element;
    }) as typeof document.createElement);
    const user = mount(); user.person = ada; create.mockRestore();
    expect(user.querySelectorAll('img')).toHaveLength(1);
    expect(portrait(user).hidden).toBe(false);
    expect((user.querySelector('[data-slot="avatar"]') as HTMLElement).dataset.imageState).toBe('loaded');
  });

  it('preserves host classes and supports themed sizes and idempotent registration', () => {
    const user = mount(); user.className = 'author-class'; user.style.margin = '4px'; user.person = ada;
    expect(getComputedStyle(user).display).toBe('inline-flex');
    expect(user.classList.contains('author-class')).toBe(true); expect(user.style.margin).toBe('4px');
    registerComponent(userComponent); registerComponent(userComponent);
    expect(customElements.get('af-user')).toBe(AfUserClass);
    expect(document.querySelectorAll('style[data-af-user-styles]')).toHaveLength(1);
  });
});
