import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Video } from '@/components/kit/video';

// <Video> is a click-to-open CARD, not an embedded player: the served
// document's sandbox propagates to every nested browsing context, so a
// third-party player iframe inherits an opaque origin and refuses to run —
// readers saw a dead black frame. Instead the component renders the poster
// (an author-hosted image, or the CSS slab) with a play badge, and a link
// that opens the video on its own page in a new tab (the sandbox's
// allow-popups flags exist for exactly this). videoWatchUrl
// (lib/story-ui/video-embed) stays the whole trust boundary for the href.

describe('kit Video', () => {
  it('renders a click-to-open card: play badge and a link to the canonical watch page', () => {
    render(<Video src="https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90" title="The reveal" aria-label="video" />);
    const link = screen.getByLabelText('video').querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    // The link is the interactive element, so it carries the accessible name.
    expect(link.getAttribute('aria-label')).toContain('The reveal');
    const playBadge = document.querySelector('[data-slot="video-play"]')!;
    expect(playBadge).toBeTruthy();
    expect(playBadge.className).toContain('bg-[#FF0000]');
  });

  it('NEVER renders an iframe — the sandbox kills nested players, so nothing may emit one', () => {
    render(<Video src="https://www.youtube.com/watch?v=dQw4w9WgXcQ" aria-label="video" />);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('a resolved poster URL renders as the card image, replacing the slab', () => {
    render(<Video src="https://youtu.be/dQw4w9WgXcQ" poster="/a/img123/raw?v=3" aria-label="video" />);
    const img = document.querySelector('[data-slot="video-thumb"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/a/img123/raw?v=3');
    expect(document.querySelector('[data-slot="video-poster"]')).toBeNull();
    expect(document.querySelector('[data-slot="video-play"]')).toBeTruthy();
  });

  it('an UNRESOLVED ref: poster falls back to the slab — the ref string never reaches the DOM', () => {
    // Render paths resolve ref: through refData (lib/story/ref-data); if that
    // did not happen, an <img src="ref:x"> is a broken image and a CSP hit.
    render(<Video src="https://youtu.be/dQw4w9WgXcQ" poster="ref:img123" aria-label="video" />);
    expect(document.querySelector('[data-slot="video-thumb"]')).toBeNull();
    expect(document.querySelector('[data-slot="video-poster"]')).toBeTruthy();
  });

  it('no poster renders the slab + play badge — the capture-safe default', () => {
    render(<Video src="https://youtu.be/dQw4w9WgXcQ" aria-label="video" />);
    const poster = document.querySelector('[data-slot="video-poster"]')!;
    expect(poster).toBeTruthy();
    expect(poster.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[data-slot="video-play"]')).toBeTruthy();
  });

  it('interactive={false} renders the same card with no link — the edit canvas selects, never navigates', () => {
    render(<Video src="https://youtu.be/dQw4w9WgXcQ" interactive={false} aria-label="video" />);
    expect(document.querySelector('a')).toBeNull();
    expect(document.querySelector('[data-slot="video-play"]')).toBeTruthy();
  });

  it('keeps the 16:9 frame and merges authored classes on the wrapper', () => {
    render(<Video src="https://vimeo.com/76979871" aria-label="video" className="my-8" />);
    const wrap = screen.getByLabelText('video');
    expect(wrap.className).toContain('aspect-video');
    expect(wrap.className).toContain('my-8');
  });

  it('carries spread props (the AST stamp) on the wrapper in BOTH outcomes', () => {
    const { rerender } = render(<Video src="https://vimeo.com/76979871" aria-label="video" data-mx-ast="0.3" />);
    expect(screen.getByLabelText('video').getAttribute('data-mx-ast')).toBe('0.3');
    rerender(<Video src="https://evil.example/x" aria-label="video" data-mx-ast="0.3" />);
    expect(screen.getByLabelText('video').getAttribute('data-mx-ast')).toBe('0.3');
  });

  it('an unsupported source renders a quiet notice — no link, no poster, nothing pretends a video is there', () => {
    render(<Video src="https://evil.example/embed/x" aria-label="video" />);
    expect(document.querySelector('a')).toBeNull();
    expect(document.querySelector('[data-slot="video-poster"]')).toBeNull();
    expect(screen.getByLabelText('Video unavailable')).toBeTruthy();
  });

  it('a missing src renders the notice too', () => {
    render(<Video aria-label="video" />);
    expect(document.querySelector('a')).toBeNull();
    expect(screen.getByLabelText('Video unavailable')).toBeTruthy();
  });

  it('falls back to a generic accessible link name when no title is authored', () => {
    render(<Video src="https://youtu.be/dQw4w9WgXcQ" aria-label="video" />);
    const link = document.querySelector('a')!;
    expect(link.getAttribute('aria-label')).toBeTruthy();
  });
});
