/**
 * THE PROFILE-PICTURE UPLOADER. A person with no picture sees an empty circle
 * and a labelled "Upload a photo" button, never a generated initial that reads
 * as "picture done"; one with a picture sees it and "Change photo". The button
 * is the one named control; the circle is a presentational shortcut to the
 * same picker. Refusals are sentences and leave the previous state in place.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { DEFAULT_UPLOAD_MAX_BYTES } from '@artifactbin/contracts';
import AvatarCircle from '@/components/AvatarCircle';

const IMAGE = '/api/users/usr_ada/avatar?v=deadbeef';
const calls: Array<{ url: string; method: string | undefined }> = [];
const answer = { status: 200, body: { image: IMAGE } as Record<string, unknown> };
/** Held open until released, so the in-flight state can be observed. */
let gate: Promise<void> = Promise.resolve();

beforeEach(() => {
  calls.length = 0;
  answer.status = 200;
  answer.body = { image: IMAGE };
  gate = Promise.resolve();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method });
    await gate;
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const png = () => new File([new Uint8Array([1, 2, 3])], 'me.png', { type: 'image/png' });
const choose = (container: HTMLElement) => {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [png()] } });
};

/** A page as both call sites are: it owns `image` and hands it back in. */
function Harness({ initial = null, onRemove }: { initial?: string | null; onRemove?: () => void }) {
  const [image, setImage] = useState<string | null>(initial);
  return (
    <AvatarCircle
      image={image}
      initial="ada"
      userId="usr_ada"
      onChange={setImage}
      onRemove={onRemove ? () => { setImage(null); onRemove(); } : undefined}
    />
  );
}

describe('<AvatarCircle> with no picture', () => {
  it('shows an empty circle and "Upload a photo" with the accepted formats and size — no initial', () => {
    const { container } = render(<Harness />);
    expect(screen.getByRole('button', { name: 'Upload a photo' })).toBeInTheDocument();
    const hint = `PNG, JPEG, WebP, GIF or AVIF · up to ${DEFAULT_UPLOAD_MAX_BYTES / 1_000_000} MB`;
    // The whole sentence, read as a person does: the size limit is its own nowrap span.
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === hint)).toBeInTheDocument();
    expect(container.querySelector('[data-face-initial]')).toBeNull();
    expect(screen.queryByText('A')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change photo' })).toBeNull();
  });

  it('has exactly one named control: the circle is hidden from assistive tech and out of the tab order', () => {
    const { container } = render(<Harness />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const circle = container.querySelector('[data-avatar-circle]') as HTMLElement;
    expect(circle).toHaveAttribute('aria-hidden', 'true');
    expect(circle.tabIndex).toBe(-1);
  });

  it('opens the same file picker from the button and from the circle', () => {
    const { container } = render(<Harness />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Upload a photo' }));
    fireEvent.click(container.querySelector('[data-avatar-circle]') as HTMLElement);
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('disables the button and reads "Uploading…" while the server has the file, then shows the picture and "Change photo"', async () => {
    let release!: () => void;
    gate = new Promise((r) => { release = r; });
    const { container } = render(<Harness />);
    choose(container);

    const busy = await screen.findByRole('button', { name: 'Uploading…' });
    expect(busy).toBeDisabled();
    expect(container.querySelector('[data-avatar-circle] .animate-spin')).not.toBeNull();

    release();
    expect(await screen.findByRole('button', { name: 'Change photo' })).toBeInTheDocument();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(IMAGE);
    expect(screen.queryByRole('button', { name: 'Upload a photo' })).toBeNull();
    expect(calls).toEqual([{ url: '/api/my/profile/image', method: 'PUT' }]);
  });

  it('says why a picture was refused and keeps the empty state', async () => {
    answer.status = 413;
    answer.body = { error: 'image_too_large' };
    const { container } = render(<Harness />);
    choose(container);

    expect(await screen.findByText(/over 50 MB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload a photo' })).toBeEnabled();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-face-initial]')).toBeNull();
  });
});

describe('<AvatarCircle> with a picture', () => {
  it('shows the picture and an outlined "Change photo", and no Remove unless the page offers it', () => {
    const { container } = render(<Harness initial={IMAGE} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(IMAGE);
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByText(/up to \d+ MB/)).toBeNull();
  });

  it('keeps the picture when a change is refused', async () => {
    answer.status = 415;
    answer.body = { error: 'unsupported_image' };
    const { container } = render(<Harness initial={IMAGE} />);
    choose(container);
    expect(await screen.findByText(/not a picture this can use/)).toBeInTheDocument();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(IMAGE);
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeEnabled();
  });

  it('offers Remove when the page gives onRemove, and removing returns to the empty uploader', async () => {
    const onRemove = vi.fn();
    answer.body = { image: null };
    const { container } = render(<Harness initial={IMAGE} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));

    expect(await screen.findByRole('button', { name: 'Upload a photo' })).toBeInTheDocument();
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([{ url: '/api/my/profile/image', method: 'DELETE' }]);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
  });
});

/**
 * The ACCOUNT page does not hand the new address straight back: it re-fetches
 * its data, and until that lands its `image` prop is still the old one. The
 * uploader must show what the server just answered in that gap, or a person who
 * uploaded a picture sees "Upload a photo" flash as if nothing happened.
 */
describe('<AvatarCircle> while the page is still catching up', () => {
  it('shows the uploaded picture before the page passes it back, then follows the page', async () => {
    // A Response whose body is read a macrotask later, as a real network's is.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: () => new Promise((r) => setTimeout(() => r({ image: IMAGE }), 20)) })));
    const { container, rerender } = render(<AvatarCircle image={null} initial="ada" userId="usr_ada" onChange={() => {}} />);
    // Every label the button shows, in order: an upload never goes back through "Upload a photo".
    const labels: string[] = [];
    const record = () => { const l = container.querySelector('button')?.textContent ?? ''; if (labels.at(-1) !== l) labels.push(l); };
    record();
    const observer = new MutationObserver(record);
    observer.observe(container, { subtree: true, childList: true, characterData: true });
    choose(container);
    await screen.findByRole('button', { name: 'Change photo' });
    observer.disconnect();
    expect(labels).toEqual(['Upload a photo', 'Uploading…', 'Change photo']);
    expect(screen.queryByRole('button', { name: 'Upload a photo' })).toBeNull();
    // The page's own answer is the truth once it arrives, whatever it says.
    rerender(<AvatarCircle image={null} initial="ada" userId="usr_ada" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
    rerender(<AvatarCircle image="/api/users/usr_ada/avatar?v=next" initial="ada" userId="usr_ada" onChange={() => {}} />);
    rerender(<AvatarCircle image={null} initial="ada" userId="usr_ada" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Upload a photo' })).toBeInTheDocument();
  });
});
