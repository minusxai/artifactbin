/**
 * THE APP'S ONE FACE. The initial on the person's own colour is always drawn,
 * and a picture is painted over it — so a failing address reveals the initial,
 * never a broken-image glyph — and the colour is the one the document kit
 * draws for the same id.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { PersonCard } from '@artifactbin/contracts';
import Avatar from '@/components/Avatar';
import { UserImage } from '@/components/kit/user-image';
import { personFaceBackground } from '@/lib/person-face';
import { ListingHero } from '@/components/Listing';

/** The colour as the DOM stores it: jsdom normalises `hsl(...)` to `rgb(...)`. */
const asDrawn = (css: string) => { const probe = document.createElement('span'); probe.style.backgroundColor = css; return probe.style.backgroundColor; };
const initialOf = (root: HTMLElement) => root.querySelector('[data-face-initial]') as HTMLElement | null;

describe('<Avatar>', () => {
  it('draws the initial on the colour person-face decides for the id', () => {
    const { container } = render(<Avatar image={null} initial="grace" userId="usr_grace" size={40} />);
    const initial = initialOf(container)!;
    expect(initial).toHaveTextContent('G');
    expect(initial.style.backgroundColor).toBe(asDrawn(personFaceBackground('usr_grace')));
    expect(container.querySelector('img')).toBeNull();
  });

  it('paints a picture OVER the initial, which stays in the DOM beneath it', () => {
    const { container } = render(<Avatar image="/api/users/usr_ada/avatar?v=1" initial="ada" userId="usr_ada" size={40} />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', '/api/users/usr_ada/avatar?v=1');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveClass('absolute', 'inset-0');
    expect(initialOf(container)).toHaveTextContent('A');
    // The picture comes after the initial in paint order.
    expect(initialOf(container)!.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('leaves the initial showing when the picture fails, and gives a new address its own chance', () => {
    const view = render(<Avatar image="/gone" initial="ada" userId="usr_ada" size={40} />);
    fireEvent.error(view.container.querySelector('img')!);
    expect(view.container.querySelector('img')).toBeNull();
    expect(initialOf(view.container)).toHaveTextContent('A');
    view.rerender(<Avatar image="/fresh" initial="ada" userId="usr_ada" size={40} />);
    expect(view.container.querySelector('img')).toHaveAttribute('src', '/fresh');
  });

  it('sizes the initial at about 42% of the diameter, and fills its container when no size is given', () => {
    const sized = render(<Avatar image={null} initial="ada" userId="usr_ada" size={48} />);
    expect(initialOf(sized.container)!.style.fontSize).toBe('20px');
    const filling = render(<Avatar image={null} initial="ada" userId="usr_ada" />);
    const box = filling.container.firstElementChild as HTMLElement;
    expect(box.style.width).toBe('100%');
    expect(initialOf(filling.container)).toHaveClass('text-3xl');
  });
});

describe('the app and the document kit draw a person in one colour', () => {
  it('uses personFaceBackground(id) in both', () => {
    const card: PersonCard = { name: 'Grace', handle: 'grace', image: null };
    const app = render(<Avatar image={null} initial="grace" userId="usr_grace" size={32} />);
    const kit = render(<UserImage id="usr_grace" card={card} />);
    const colour = asDrawn(personFaceBackground('usr_grace'));
    expect(colour).not.toBe('');
    expect(initialOf(app.container)!.style.backgroundColor).toBe(colour);
    expect((kit.container.querySelector('[data-slot="avatar"]') as HTMLElement).style.backgroundColor).toBe(colour);
  });
});

describe('the profile header', () => {
  it('draws the owner\'s initial when they have no picture', () => {
    const { container } = render(<ListingHero handle="grace" label="public index" count={0} noun="public artifact" owner={{ id: 'usr_grace', image: null }} />);
    const initial = initialOf(container.querySelector('header')!)!;
    expect(initial).toHaveTextContent('G');
    expect(initial.style.backgroundColor).toBe(asDrawn(personFaceBackground('usr_grace')));
    expect(container.querySelector('img')).toBeNull();
  });

  it('paints the owner\'s picture over that initial when they have one', () => {
    const { container } = render(<ListingHero handle="ada" label="public index" count={0} noun="public artifact" owner={{ id: 'usr_ada', image: '/api/users/usr_ada/avatar?v=1' }} />);
    expect(container.querySelector('header img')).toHaveAttribute('src', '/api/users/usr_ada/avatar?v=1');
    expect(initialOf(container.querySelector('header')!)).toHaveTextContent('A');
  });

  it('draws no face when the owner is not known', () => {
    const { container } = render(<ListingHero handle="ada" label="public index" count={0} noun="public artifact" />);
    expect(initialOf(container)).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
