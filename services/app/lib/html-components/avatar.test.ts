// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AfAvatar, AfAvatarImage, registerAvatar } from './avatar';
import type { AvatarStatus } from './avatar';

registerAvatar();
afterEach(() => document.body.replaceChildren());

function fixture(attrs = '', imageAttrs = 'src="/person.png" alt="Ada Lovelace"') {
  const host = document.createElement('div');
  host.innerHTML = `<af-avatar ${attrs}><af-avatar-image ${imageAttrs} data-af-id="portrait"></af-avatar-image><af-avatar-fallback data-af-id="fallback">AL</af-avatar-fallback><af-avatar-badge data-af-id="badge">online</af-avatar-badge></af-avatar>`;
  document.body.append(host);
  const avatar = host.firstElementChild as AfAvatar;
  const image = avatar.querySelector('af-avatar-image') as AfAvatarImage;
  return { host, avatar, image, fallback: avatar.querySelector('af-avatar-fallback') as HTMLElement, badge: avatar.querySelector('af-avatar-badge') as HTMLElement };
}
function naturalSize(image: HTMLImageElement, width = 48): void {
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width });
}
const state = (avatar: AfAvatar): AvatarStatus => avatar.status;

describe('native light-DOM avatars', () => {
  it('shows authored fallback while loading, then reveals the native image without replacing authored identities', () => {
    const { avatar, image, fallback } = fixture();
    const authoredImage = avatar.querySelector('[data-af-id="portrait"]');
    const authoredFallback = avatar.querySelector('[data-af-id="fallback"]');
    const img = image.querySelector('img')!;
    expect(state(avatar)).toBe('loading'); expect(fallback.hidden).toBe(false);
    expect(img.getAttribute('src')).toBe('/person.png'); expect(img.alt).toBe('Ada Lovelace');
    naturalSize(img); img.dispatchEvent(new Event('load'));
    expect(state(avatar)).toBe('loaded'); expect(fallback.hidden).toBe(true);
    expect(avatar.querySelector('[data-af-id="portrait"]')).toBe(authoredImage);
    expect(avatar.querySelector('[data-af-id="fallback"]')).toBe(authoredFallback);
    expect(authoredFallback?.textContent).toBe('AL');
  });

  it('keeps fallback on missing or failed sources and reflects the status on the host', () => {
    const missing = fixture('', 'alt="No portrait"');
    expect(state(missing.avatar)).toBe('error'); expect(missing.fallback.hidden).toBe(false);
    expect(missing.avatar.dataset.state).toBe('error');
    const failed = fixture('', 'src="/missing.png" alt="Missing"');
    failed.image.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(state(failed.avatar)).toBe('error'); expect(failed.fallback.hidden).toBe(false);
  });

  it('restarts loading on src changes and ignores events from the replaced image generation', () => {
    const { avatar, image, fallback } = fixture();
    const previous = image.querySelector('img')!;
    image.src = '/second.png';
    const current = image.querySelector('img')!;
    expect(current).not.toBe(previous); expect(current.getAttribute('src')).toBe('/second.png');
    expect(state(avatar)).toBe('loading'); expect(fallback.hidden).toBe(false);
    naturalSize(previous); previous.dispatchEvent(new Event('load'));
    expect(state(avatar)).toBe('loading');
    naturalSize(current); current.dispatchEvent(new Event('load'));
    expect(state(avatar)).toBe('loaded'); expect(fallback.hidden).toBe(true);
  });

  it('uses a cached complete image immediately and supports property and attribute updates', () => {
    const originalCreate = document.createElement.bind(document);
    const create = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreate(tagName, options);
      if (tagName.toLowerCase() === 'img') {
        Object.defineProperty(element, 'complete', { configurable: true, value: true });
        Object.defineProperty(element, 'naturalWidth', { configurable: true, value: 64 });
      }
      return element;
    }) as typeof document.createElement);
    const { avatar, image } = fixture('size="lg"');
    create.mockRestore();
    expect(state(avatar)).toBe('loaded'); expect(image.querySelector('img')?.alt).toBe('Ada Lovelace');
    expect(avatar.size).toBe('lg');
    image.src = '/property.png';
    expect(image.getAttribute('src')).toBe('/property.png'); expect(state(avatar)).toBe('loading');
    naturalSize(image.querySelector('img')!); image.querySelector('img')!.dispatchEvent(new Event('load'));
    expect(state(avatar)).toBe('loaded');
  });

  it('supports size variants, standalone badges, and overlapping groups with count', () => {
    const { avatar, badge } = fixture('size="sm"');
    expect(getComputedStyle(avatar).width).toBe('24px');
    expect(avatar.dataset.size).toBe('sm');
    expect(badge.dataset.slot).toBe('avatar-badge');
    const group = document.createElement('af-avatar-group');
    group.innerHTML = '<af-avatar size="lg"><af-avatar-fallback>A</af-avatar-fallback></af-avatar><af-avatar-group-count data-af-id="count">+3</af-avatar-group-count>';
    document.body.append(group);
    expect(getComputedStyle(group).display).toBe('flex');
    expect(group.querySelector('[data-af-id="count"]')?.textContent).toBe('+3');
  });

  it('cleans up image listeners on removal, reconnects, and does not duplicate status events', () => {
    const { avatar, image } = fixture();
    const authored = image;
    const oldImage = image.querySelector('img')!;
    avatar.remove(); document.body.append(avatar);
    expect(avatar.querySelector('af-avatar-image')).toBe(authored);
    let changes = 0; avatar.addEventListener('af-avatar-status', () => changes++);
    const current = image.querySelector('img')!;
    naturalSize(oldImage); oldImage.dispatchEvent(new Event('load'));
    naturalSize(current); current.dispatchEvent(new Event('load'));
    expect(state(avatar)).toBe('loaded'); expect(changes).toBe(1);
  });

  it('registers all avatar parts and styles idempotently', () => {
    registerAvatar(); registerAvatar();
    for (const name of ['af-avatar', 'af-avatar-image', 'af-avatar-fallback', 'af-avatar-badge', 'af-avatar-group', 'af-avatar-group-count']) {
      expect(customElements.get(name)).toBeDefined();
    }
    expect(document.querySelectorAll('style[data-af-avatar-styles]')).toHaveLength(1);
  });
});
