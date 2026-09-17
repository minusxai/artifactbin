/**
 * videoEmbedUrl — the trust boundary that lets stories embed video WITHOUT the
 * validator giving up its iframe ban. Raw <iframe> stays rejected everywhere;
 * the <Video> component renders the iframe itself, and this function decides
 * what it may point at: a small allowlist of video hosts, each normalized to
 * ONE canonical embed URL built from the parsed video id — never echoed input.
 */
import { describe, it, expect } from 'vitest';

import { videoEmbedUrl, videoWatchUrl } from '@/lib/story-ui/video-embed';
import { validateJsxSource } from '@/lib/jsx';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '@/lib/story-ui/component-names';
import { collectRefUses, findExternalSubresources, findBrokenEmbeds } from '@/lib/story/refs';
import { collectExternalImageUrls } from '@/lib/story/external-images';

describe('videoEmbedUrl — YouTube', () => {
  it('normalizes an /embed/ URL to the privacy-enhanced host, dropping tracking params', () => {
    expect(videoEmbedUrl('https://www.youtube.com/embed/87DyyMV0kCY?si=JppgqZfR8LBPf8MS'))
      .toBe('https://www.youtube-nocookie.com/embed/87DyyMV0kCY');
  });

  it('accepts watch URLs, youtu.be short links and shorts', () => {
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ'))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbedUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbedUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('keeps a start time when one is given', () => {
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90'))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90');
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ?t=90s'))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90');
  });

  it('rejects malformed video ids — the id IS the injection surface', () => {
    expect(videoEmbedUrl('https://www.youtube.com/embed/../evil')).toBeNull();
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQtoolong')).toBeNull();
  });
});

describe('videoEmbedUrl — other hosts', () => {
  it('normalizes Vimeo page and player URLs', () => {
    expect(videoEmbedUrl('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871');
    expect(videoEmbedUrl('https://player.vimeo.com/video/76979871')).toBe('https://player.vimeo.com/video/76979871');
  });

  it('normalizes Loom share and embed URLs', () => {
    expect(videoEmbedUrl('https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184'))
      .toBe('https://www.loom.com/embed/0281766fa2d04bb788eaf19e65135184');
    expect(videoEmbedUrl('https://loom.com/embed/0281766fa2d04bb788eaf19e65135184'))
      .toBe('https://www.loom.com/embed/0281766fa2d04bb788eaf19e65135184');
  });
});

describe('videoEmbedUrl — everything else is refused', () => {
  it('unknown hosts, lookalikes and non-URLs are null', () => {
    expect(videoEmbedUrl('https://evil.example/embed/dQw4w9WgXcQ')).toBeNull();
    expect(videoEmbedUrl('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(videoEmbedUrl('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(videoEmbedUrl('javascript:alert(1)')).toBeNull();
    expect(videoEmbedUrl('not a url')).toBeNull();
    expect(videoEmbedUrl('')).toBeNull();
    expect(videoEmbedUrl(undefined)).toBeNull();
    expect(videoEmbedUrl(42)).toBeNull();
  });

  it('an http link still resolves — the output is OUR constructed https URL either way', () => {
    expect(videoEmbedUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });
});

describe('videoWatchUrl — the click-through target', () => {
  // The card opens the video on its OWN page (the document's sandbox admits no
  // third-party frame), so the same parse resolves a second canonical URL:
  // the watch page, constructed from the id — never echoed input.
  it('resolves every accepted YouTube shape to the canonical watch page', () => {
    expect(videoWatchUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(videoWatchUrl('https://youtu.be/dQw4w9WgXcQ'))
      .toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(videoWatchUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'))
      .toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(videoWatchUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'))
      .toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('keeps a start time', () => {
    expect(videoWatchUrl('https://youtu.be/dQw4w9WgXcQ?t=90'))
      .toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s');
    expect(videoWatchUrl('https://vimeo.com/76979871?t=90s'))
      .toBe('https://vimeo.com/76979871#t=90s');
  });

  it('resolves Vimeo and Loom to their share pages', () => {
    expect(videoWatchUrl('https://player.vimeo.com/video/76979871')).toBe('https://vimeo.com/76979871');
    expect(videoWatchUrl('https://loom.com/embed/0281766fa2d04bb788eaf19e65135184'))
      .toBe('https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184');
    expect(videoWatchUrl('https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184'))
      .toBe('https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184');
  });

  it('refuses exactly what videoEmbedUrl refuses', () => {
    expect(videoWatchUrl('https://evil.example/embed/dQw4w9WgXcQ')).toBeNull();
    expect(videoWatchUrl('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(videoWatchUrl('javascript:alert(1)')).toBeNull();
    expect(videoWatchUrl('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(videoWatchUrl(undefined)).toBeNull();
  });
});

describe('the poster is a hosted image ref', () => {
  it('poster="ref:<id>" on <Video> is collected as an image ref', () => {
    const uses = collectRefUses('<div><Video src="https://youtu.be/dQw4w9WgXcQ" poster="ref:abc123" /></div>');
    expect(uses).toContainEqual({ id: 'abc123', kind: 'image' });
  });

  it('poster is only a ref position on <Video> — nowhere else', () => {
    const uses = collectRefUses('<div data-poster="x"><span poster="ref:abc123" /></div>');
    expect(uses).toEqual([]);
  });

  it('an external poster URL is IMPORTED, not hotlinked — the document still owns its bytes', () => {
    // The poster is an image position, so the publish door fetches it and
    // rewrites it to ref:<id> (__tests__/web-import.test.ts drives that end to
    // end). What must stay true here: it is not left pointing at i.ytimg.com.
    const errors = findExternalSubresources(
      '<div><Video src="https://youtu.be/dQw4w9WgXcQ" poster="https://i.ytimg.com/vi/x/hq.jpg" /></div>',
    );
    expect(errors).toEqual([]);
    expect(collectExternalImageUrls(
      '<div><Video src="https://youtu.be/dQw4w9WgXcQ" poster="https://i.ytimg.com/vi/x/hq.jpg" /></div>',
    )).toEqual(['https://i.ytimg.com/vi/x/hq.jpg']);
  });

  it('a ref: poster passes the self-contained rule', () => {
    expect(findExternalSubresources(
      '<div><Video src="https://youtu.be/dQw4w9WgXcQ" poster="ref:abc123" /></div>',
    )).toEqual([]);
  });
});

describe('the validator boundary', () => {
  it('<Video> is registered story vocabulary', () => {
    const errors = validateJsxSource(
      '<Video src="https://www.youtube.com/embed/87DyyMV0kCY" title="Intro" />',
      JSX_STORY_COMPONENT_NAMES, STORY_HTML_TAGS,
    );
    expect(errors).toEqual([]);
  });

  it('raw <iframe> stays rejected — Video is the only way to a nested frame', () => {
    const errors = validateJsxSource(
      '<iframe src="https://www.youtube.com/embed/87DyyMV0kCY"></iframe>',
      JSX_STORY_COMPONENT_NAMES, STORY_HTML_TAGS,
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('the publish gate (lib/story/refs)', () => {
  // findExternalSubresources rejects every external src — artifacts are
  // self-contained. <Video src> is the sanctioned exception: an embed is
  // external by definition, and the allowlist (videoEmbedUrl) is its leash.
  it('allows an allowlisted <Video src> through the self-contained rule', () => {
    expect(findExternalSubresources(
      '<div><Video src="https://www.youtube.com/embed/87DyyMV0kCY?si=JppgqZfR8LBPf8MS" title="t" /></div>',
    )).toEqual([]);
  });

  it('rejects a <Video src> on an unsupported host, naming what IS supported', () => {
    const errors = findExternalSubresources('<div><Video src="https://evil.example/embed/x" /></div>');
    expect(errors.length).toBe(1);
    expect(errors[0].message).toMatch(/YouTube|Vimeo|Loom/);
    expect(errors[0].tag).toBe('Video');
  });

  it('the <Video src> carve-out stays Video-only — an <img src> is an IMPORT, not an embed', () => {
    // Neither refuses now, but for different reasons, and the difference is
    // the point: a Video src is an allowlisted external EMBED (nothing is
    // copied), an img src is imported and owned.
    expect(findExternalSubresources('<div><img src="https://www.youtube.com/favicon.ico" /></div>')).toEqual([]);
    expect(collectExternalImageUrls('<div><img src="https://www.youtube.com/favicon.ico" /></div>'))
      .toEqual(['https://www.youtube.com/favicon.ico']);
    // A Video src is never imported — it stays a link to the host's player.
    expect(collectExternalImageUrls('<div><Video src="https://youtu.be/dQw4w9WgXcQ" /></div>')).toEqual([]);
  });

  it('a <Video> with no src cannot render — rejected with the fix named', () => {
    const errors = findBrokenEmbeds('<div><Video title="t" /></div>');
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain('src');
  });
});
