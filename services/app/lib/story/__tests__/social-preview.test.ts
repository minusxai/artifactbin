import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOCIAL_PREVIEW_CROP,
  parseSocialPreviewCrop,
  savedSocialPreviewCrop,
  socialPreviewCrop,
  socialPreviewCropHeight,
  writeSocialPreviewCrop,
  socialPreviewImage,
  writeSocialPreviewImage,
  defaultImageCrop,
  clampImageCrop,
  savedSocialPreviewImageCrop,
  writeSocialPreviewImageCrop,
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

describe('uploaded social preview', () => {
  it('adds, replaces and removes the image without disturbing saved framing', () => {
    const original = writeSocialPreviewCrop('<Helmet /><p>x</p>', { x: 20, y: 30, width: 600 });
    const image = writeSocialPreviewImage(original, 'image1');
    expect(socialPreviewImage(image)).toBe('image1');
    expect(savedSocialPreviewCrop(image)).toEqual({ x: 20, y: 30, width: 600 });
    expect(socialPreviewImage(writeSocialPreviewImage(image, 'image2'))).toBe('image2');
    expect(writeSocialPreviewImage(image, null)).toBe(original);
    expect(socialPreviewImage(writeSocialPreviewImage('<p>x</p>', 'image3'))).toBe('image3');
  });
});

it('bounds image framing for portrait and very wide images independently of document framing', () => {
  expect(defaultImageCrop(1600)).toEqual({ x: 0, y: 380, width: 1600 });
  const wide = defaultImageCrop(105);
  expect(wide).toEqual({ x: 700, y: 0, width: 200 });
  expect(clampImageCrop({ x: 9999, y: 9999, width: 1600 }, 105)).toEqual({ x: 1400, y: 0, width: 200 });
  const source = writeSocialPreviewCrop('<p>x</p>', { x: 0, y: 900, width: 800 });
  const withImage = writeSocialPreviewImageCrop(source, wide);
  expect(savedSocialPreviewImageCrop(withImage)).toEqual(wide);
  expect(savedSocialPreviewCrop(withImage)).toEqual({ x: 0, y: 900, width: 800 });
  expect(writeSocialPreviewImageCrop(withImage, null)).toBe(source);
});
