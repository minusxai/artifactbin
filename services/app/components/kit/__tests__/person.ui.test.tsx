/**
 * A PERSON, AS THREE PRIMITIVES.
 *
 * `<UserImage>` is the picture, `<UserHandle>` is the name you can click, and
 * `<User>` is the two of them together — so a document that wants only a face
 * or only a handle does not have to take the other. All three resolve NOTHING
 * themselves: the card is handed to them (lib/story-runtime/StoryRuntimeApp
 * usePerson), which is what keeps an id the server never put in front of this
 * viewer a neutral "Unknown person" rather than a lookup.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { PersonCard } from '@artifactbin/contracts';
import { UserImage } from '@/components/kit/user-image';
import { UserHandle } from '@/components/kit/user-handle';
import { User, UNKNOWN_PERSON } from '@/components/kit/user';
import { personFaceBackground } from '@/lib/person-face';

/** The colour as the DOM stores it: jsdom normalises `hsl(...)` to `rgb(...)`. */
const asDrawn = (css: string) => { const probe = document.createElement('span'); probe.style.backgroundColor = css; return probe.style.backgroundColor; };

const ADA: PersonCard = { name: 'Ada Lovelace', handle: 'ada', image: '/api/users/usr_ada/avatar?v=abc' };
const NAMELESS: PersonCard = { name: 'Grace', handle: null, image: null };

describe('<UserImage>', () => {
  it('draws the picture a card carries, named by the person it shows', () => {
    const view = render(<UserImage id="usr_ada" card={ADA} />);
    const img = view.container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/api/users/usr_ada/avatar?v=abc');
    expect(img.getAttribute('alt')).toBe('Ada Lovelace');
    expect(img.getAttribute('aria-hidden')).toBeNull();
  });

  /*
   * A picture is an ADDRESS, and an address can fail. The initial stays
   * underneath it, so a 404 reveals a person rather than a browser's broken
   * glyph — which is the promise `<UserImage>` makes.
   */
  it('keeps the initial underneath the picture, so a failed address is not a broken image', () => {
    const view = render(<UserImage id="usr_ada" card={ADA} />);
    const fallback = view.container.querySelector('[data-slot="avatar-fallback"]')!;
    expect(fallback.textContent).toBe('A');
    const box = view.container.querySelector('[data-slot="avatar"]') as HTMLElement;
    expect(box.style.backgroundColor).toBe(asDrawn(personFaceBackground('usr_ada')));
    // The picture is painted OVER it, not beside it.
    expect(view.container.querySelector('img')!.className).toContain('absolute');
  });

  it('is decorative beside a name: an empty alt and hidden from the accessibility tree', () => {
    const view = render(<UserImage id="usr_ada" card={ADA} decorative />);
    const img = view.container.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
  });

  /*
   * No picture is the COMMON case, and a broken image or a grey blank is not an
   * answer: the initial goes on a hue derived from the id alone, so the server
   * string and the hydrated tree are the same tree and two people are told
   * apart at a glance.
   */
  it('falls back to the initial on a hue the id alone decides', () => {
    const view = render(<UserImage id="usr_grace" card={NAMELESS} />);
    expect(view.container.querySelector('img')).toBeNull();
    const fallback = view.container.querySelector('[data-slot="avatar-fallback"]')!;
    expect(fallback.textContent).toBe('G');
    const face = (node: ReturnType<typeof render>) => (node.container.querySelector('[data-slot="avatar"]') as HTMLElement).style.backgroundColor;
    // The colour is person-face's, the same one the app bar draws for this id.
    expect(face(view)).toBe(asDrawn(personFaceBackground('usr_grace')));
    expect(face(render(<UserImage id="usr_grace" card={NAMELESS} />))).toBe(face(view));
    expect(face(render(<UserImage id="usr_ada" card={NAMELESS} />))).not.toBe(face(view));
  });

  it('shows a neutral mark for an id it cannot name, and never the id itself', () => {
    const view = render(<UserImage id="usr_nobody" card={null} />);
    expect(view.container.textContent).toBe('?');
    expect(view.container.textContent).not.toContain('usr_nobody');
    expect(view.container.querySelector('[data-unknown]')).toBeTruthy();
  });

  it('renders nothing for an unset field, or the author\'s fallback', () => {
    expect(render(<UserImage id={null} />).container.innerHTML).toBe('');
    expect(render(<UserImage id={null} fallback="nobody" />).container.textContent).toBe('nobody');
  });

  it('sizes are 20 / 32 / 48, and the default is the smallest', () => {
    const box = (node: ReturnType<typeof render>) => (node.container.querySelector('[data-slot="avatar"]') as HTMLElement).className;
    expect(box(render(<UserImage id="usr_ada" card={ADA} />))).toBe(box(render(<UserImage id="usr_ada" card={ADA} size="sm" />)));
    expect(box(render(<UserImage id="usr_ada" card={ADA} size="sm" />))).toContain('size-5');
    expect(box(render(<UserImage id="usr_ada" card={ADA} size="md" />))).toContain('size-8');
    expect(box(render(<UserImage id="usr_ada" card={ADA} size="lg" />))).toContain('size-12');
  });
});

describe('<UserHandle>', () => {
  it('is the handle, linked to the profile, and leaves the document frame', () => {
    const view = render(<UserHandle id="usr_ada" card={ADA} />);
    const link = view.container.querySelector('a')!;
    expect(link.textContent).toBe('@ada');
    expect(link.getAttribute('href')).toBe('/@ada');
    // Every door out of a document opens the top window, never the frame.
    expect(link.getAttribute('target')).toBe('_top');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('is plain text when the author asked for no link', () => {
    const view = render(<UserHandle id="usr_ada" card={ADA} link={false} />);
    expect(view.container.querySelector('a')).toBeNull();
    expect(view.container.textContent).toBe('@ada');
  });

  it('falls back to the display name when a person has no handle', () => {
    const view = render(<UserHandle id="usr_grace" card={NAMELESS} />);
    expect(view.container.textContent).toBe('Grace');
    expect(view.container.querySelector('a')).toBeNull();
  });

  it('reads an id it cannot name as a neutral person, never the raw id', () => {
    const view = render(<UserHandle id="usr_nobody" card={null} />);
    expect(view.container.textContent).toBe(UNKNOWN_PERSON);
    expect(view.container.textContent).not.toContain('usr_nobody');
  });

  it('renders nothing for an unset field, or the author\'s fallback', () => {
    expect(render(<UserHandle id={null} />).container.innerHTML).toBe('');
    expect(render(<UserHandle id={null} fallback="nobody" />).container.textContent).toBe('nobody');
  });
});

describe('<User>', () => {
  it('is the picture and the handle together, by default', () => {
    const view = render(<User id="usr_ada" card={ADA} />);
    expect(view.container.querySelector('img')!.getAttribute('alt')).toBe('');
    expect(view.container.querySelector('[data-slot="user-handle"]')!.textContent).toBe('@ada');
  });

  it('drops the picture for avatar={false}, and keeps it for every other value', () => {
    expect(render(<User id="usr_ada" card={ADA} avatar={false} />).container.querySelector('[data-slot="avatar"]')).toBeNull();
    for (const avatar of [undefined, true, '']) {
      expect(render(<User id="usr_ada" card={ADA} avatar={avatar} />).container.querySelector('[data-slot="avatar"]')).toBeTruthy();
    }
  });

  it('answers an id it cannot name with one neutral person, never the raw id', () => {
    const view = render(<User id="usr_nobody" card={null} />);
    expect(view.container.querySelector('[data-slot="user-handle"]')!.textContent).toBe(UNKNOWN_PERSON);
    expect(view.container.textContent).not.toContain('usr_nobody');
  });

  /*
   * NO ADAPTER behind it — the deck rail's inert preview, a static registry
   * render — is exactly an id we cannot name, and must never pretend otherwise.
   */
  it('names nobody when nothing resolved the card', () => {
    const view = render(<User id="usr_ada" />);
    expect(view.container.textContent).toContain(UNKNOWN_PERSON);
    expect(view.container.textContent).not.toContain('usr_ada');
  });

  it('renders nothing for an unset field, or the author\'s fallback', () => {
    expect(render(<User id={null} />).container.innerHTML).toBe('');
    expect(render(<User id={null} fallback="nobody" />).container.textContent).toBe('nobody');
  });
});
