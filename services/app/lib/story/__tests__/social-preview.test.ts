import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOCIAL_PREVIEW_CROP,
  parseSocialPreviewCrop,
  savedSocialPreviewCrop,
  socialPreviewCrop,
  socialPreviewCropHeight,
  writeSocialPreviewCrop,
} from '../social-preview';

describe('social preview crop', () => {
  it('parses the canonical x/y/width grammar and derives its locked height', () => {
    expect(parseSocialPreviewCrop('x=300;y=900;width=800')).toEqual({ x: 300, y: 900, width: 800 });
    expect(socialPreviewCropHeight(800)).toBe(420);
  });

  it.each([
    'x=-1;y=0;width=800',
    'x=0;y=0;width=399',
    'x=0;y=0;width=1601',
    'x=0;y=0;width=800.5',
    'y=0;x=0;width=800',
    'x=0;y=0;width=800;zoom=2',
  ])('rejects malformed or unsupported content: %s', (content) => {
    expect(parseSocialPreviewCrop(content)).toBeNull();
  });

  it('adds the directive to an existing, self-closing, or absent Helmet', () => {
    expect(writeSocialPreviewCrop('<Helmet><title>T</title></Helmet><p>x</p>', { x: 1, y: 2, width: 800 }))
      .toBe('<Helmet><title>T</title><meta name="artifactbin:og-crop" content="x=1;y=2;width=800" /></Helmet><p>x</p>');
    expect(writeSocialPreviewCrop('<Helmet /><p>x</p>', { x: 1, y: 2, width: 800 }))
      .toBe('<Helmet><meta name="artifactbin:og-crop" content="x=1;y=2;width=800" /></Helmet><p>x</p>');
    expect(writeSocialPreviewCrop('<p>x</p>', { x: 1, y: 2, width: 800 }))
      .toBe('<Helmet><meta name="artifactbin:og-crop" content="x=1;y=2;width=800" /></Helmet>\n<p>x</p>');
  });

  it('replaces exactly the existing directive and removes it on reset', () => {
    const source = '<Helmet><title>T</title><meta name="artifactbin:og-crop" content="x=0;y=0;width=1600" /><meta name="description" content="D" /></Helmet><p>x</p>';
    const changed = writeSocialPreviewCrop(source, { x: 20, y: 30, width: 600 });
    expect(savedSocialPreviewCrop(changed)).toEqual({ x: 20, y: 30, width: 600 });
    expect(writeSocialPreviewCrop(changed, null)).toBe('<Helmet><title>T</title><meta name="description" content="D" /></Helmet><p>x</p>');
  });

  it('uses the top-left full-width default for absent or malformed directives', () => {
    expect(socialPreviewCrop('<p>x</p>')).toEqual(DEFAULT_SOCIAL_PREVIEW_CROP);
    expect(socialPreviewCrop('<Helmet><meta name="artifactbin:og-crop" content="oops" /></Helmet>'))
      .toEqual(DEFAULT_SOCIAL_PREVIEW_CROP);
  });
});
