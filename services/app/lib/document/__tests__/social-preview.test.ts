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

  it('adds the directive to an existing or absent native head', () => {
    expect(writeSocialPreviewCrop('<head><title>T</title></head><p>x</p>', { x: 1, y: 2, width: 800 }))
      .toBe('<head><title>T</title><meta name="artifactbin:og-crop" content="x=1;y=2;width=800" /></head><p>x</p>');
    expect(writeSocialPreviewCrop('<p>x</p>', { x: 1, y: 2, width: 800 }))
      .toBe('<head><meta name="artifactbin:og-crop" content="x=1;y=2;width=800" /></head><p>x</p>');
  });

  it('replaces exactly the existing directive and removes it on reset', () => {
    const source = '<head><title>T</title><meta name="artifactbin:og-crop" content="x=0;y=0;width=1600" /><meta name="description" content="D" /></head><p>x</p>';
    const changed = writeSocialPreviewCrop(source, { x: 20, y: 30, width: 600 });
    expect(savedSocialPreviewCrop(changed)).toEqual({ x: 20, y: 30, width: 600 });
    expect(writeSocialPreviewCrop(changed, null)).toBe('<head><title>T</title><meta name="description" content="D" /></head><p>x</p>');
  });

  it('uses the top-left full-width default for absent or malformed directives', () => {
    expect(socialPreviewCrop('<p>x</p>')).toEqual(DEFAULT_SOCIAL_PREVIEW_CROP);
    expect(socialPreviewCrop('<head><meta name="artifactbin:og-crop" content="oops" /></head>'))
      .toEqual(DEFAULT_SOCIAL_PREVIEW_CROP);
  });
});

describe('uploaded social preview', () => {
  it('adds, replaces and removes the image without disturbing saved framing', () => {
    const original = writeSocialPreviewCrop('<head></head><p>x</p>', { x: 20, y: 30, width: 600 });
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

it('preserves native metadata identity and unrelated attributes while changing its value',()=>{
 const source='<!doctype html><html><head><meta data-af-id="stable-7" name="artifactbin:og-crop" content="x=0;y=0;width=800" data-extra="keep"></head><body>Page</body></html>';
 expect(writeSocialPreviewCrop(source,{x:10,y:20,width:600})).toBe(source.replace('x=0;y=0;width=800','x=10;y=20;width=600'));
});

it('keeps the identity of a native preview meta whose content was missing',()=>{
 const source='<html><head><meta data-af-id="saved-meta" name="artifactbin:og-crop"></head><body>Page</body></html>';
 expect(writeSocialPreviewCrop(source,{x:0,y:0,width:800})).toBe(source.replace('name="artifactbin:og-crop">','name="artifactbin:og-crop" content="x=0;y=0;width=800">'));
});
