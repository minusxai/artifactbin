import { parseJsx, type JsxElement } from '@/lib/jsx';
import { splitHelmet } from './helmet';

export const SOCIAL_PREVIEW_IMAGE_CROP_META = 'artifactbin:og-image-crop';
export const SOCIAL_PREVIEW_IMAGE_META = 'artifactbin:og-image';
export const SOCIAL_PREVIEW_META = 'artifactbin:og-crop';
export const SOCIAL_PREVIEW_WIDTH = 1600;
export const SOCIAL_PREVIEW_HEIGHT = 840;
export const SOCIAL_PREVIEW_MIN_CROP_WIDTH = 400;
/** Busts both the browser URL cache and durable render cache when overview pixels change. */
export const SOCIAL_PREVIEW_OVERVIEW_GENERATION = 2;

export interface SocialPreviewCrop {
  /** Top-left source coordinate in the canonical 1600px document layout. */
  x: number;
  y: number;
  /** Source width. Height is derived from the locked 40:21 output ratio. */
  width: number;
}

export const DEFAULT_SOCIAL_PREVIEW_CROP: SocialPreviewCrop = {
  x: 0,
  y: 0,
  width: SOCIAL_PREVIEW_WIDTH,
};

export const socialPreviewCropHeight = (width: number): number =>
  width * SOCIAL_PREVIEW_HEIGHT / SOCIAL_PREVIEW_WIDTH;

const finiteInteger = (value: string): number | null => {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

/** Strict, canonical persisted grammar. Invalid directives safely mean default framing. */
export function parseSocialPreviewCrop(content: string, minWidth = SOCIAL_PREVIEW_MIN_CROP_WIDTH): SocialPreviewCrop | null {
  const match = /^x=(0|[1-9][0-9]*);y=(0|[1-9][0-9]*);width=(0|[1-9][0-9]*)$/.exec(content);
  if (!match) return null;
  const x = finiteInteger(match[1]);
  const y = finiteInteger(match[2]);
  const width = finiteInteger(match[3]);
  if (x === null || y === null || width === null) return null;
  if (width < minWidth || width > SOCIAL_PREVIEW_WIDTH) return null;
  return { x, y, width };
}

const staticStringAttr = (element: JsxElement, name: string): string | null => {
  const attr = element.attributes.find((candidate) => candidate.name.toLowerCase() === name);
  return attr?.value.static && typeof attr.value.json === 'string' ? attr.value.json : null;
};

function cropMeta(source: string, name = SOCIAL_PREVIEW_META): { helmet: JsxElement | null; element: JsxElement | null; crop: SocialPreviewCrop | null } | null {
  const parsed = parseJsx(source);
  if (!parsed.ok) return null;
  const { helmet } = splitHelmet(parsed.nodes);
  const element = helmet?.children.find((child): child is JsxElement =>
    child.type === 'element'
    && !child.isComponent
    && child.tag.toLowerCase() === 'meta'
    && staticStringAttr(child, 'name') === name,
  ) ?? null;
  const content = element ? staticStringAttr(element, 'content') : null;
  return { helmet, element, crop: content === null ? null : parseSocialPreviewCrop(content, name === SOCIAL_PREVIEW_IMAGE_CROP_META ? 1 : SOCIAL_PREVIEW_MIN_CROP_WIDTH) };
}

/** The authored directive, or null when absent/malformed. */
export function savedSocialPreviewCrop(source: string): SocialPreviewCrop | null {
  return cropMeta(source)?.crop ?? null;
}

/** The effective crop used by exports. */
export function socialPreviewCrop(source: string): SocialPreviewCrop {
  return savedSocialPreviewCrop(source) ?? DEFAULT_SOCIAL_PREVIEW_CROP;
}

const directive = ({ x, y, width }: SocialPreviewCrop): string =>
  `<meta name="${SOCIAL_PREVIEW_META}" content="x=${x};y=${y};width=${width}" />`;

/**
 * Add, replace, or remove the crop with a source-local splice. The edit route
 * canonicalizes and validates the result; keeping this change narrow also lets
 * its concurrent-edit protocol merge unrelated document edits.
 */
export function writeSocialPreviewCrop(source: string, crop: SocialPreviewCrop | null): string {
  return writePreviewMeta(source, SOCIAL_PREVIEW_META, crop ? directive(crop) : null);
}

function writePreviewMeta(source: string, name: string, markup: string | null): string {
  const found = cropMeta(source, name);
  if (!found) return source;

  if (found.element) {
    return source.slice(0, found.element.start)
      + (markup ?? '')
      + source.slice(found.element.end);
  }
  if (!markup) return source;
  if (!found.helmet) return `<Helmet>${markup}</Helmet>${source ? `\n${source}` : ''}`;
  if (found.helmet.selfClosing) {
    return source.slice(0, found.helmet.start)
      + `<Helmet>${markup}</Helmet>`
      + source.slice(found.helmet.end);
  }
  const closing = `</${found.helmet.tag}>`;
  const at = found.helmet.end - closing.length;
  return source.slice(0, at) + markup + source.slice(at);
}

/** The uploaded image takes precedence over framing, which stays saved. */
export function socialPreviewImage(source: string): string | null {
  const found = cropMeta(source, SOCIAL_PREVIEW_IMAGE_META);
  const value = found?.element ? staticStringAttr(found.element, 'content') : null;
  return value && /^ref:[A-Za-z0-9_-]+$/.test(value) ? value.slice(4) : null;
}

export function writeSocialPreviewImage(source: string, id: string | null): string {
  if (id !== null && !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid image reference');
  return writePreviewMeta(source, SOCIAL_PREVIEW_IMAGE_META,
    id === null ? null : `<meta name="${SOCIAL_PREVIEW_IMAGE_META}" content="ref:${id}" />`);
}

/** Image coordinates use the original image scaled to 1600px wide. */
export function savedSocialPreviewImageCrop(source: string): SocialPreviewCrop | null {
  return cropMeta(source, SOCIAL_PREVIEW_IMAGE_CROP_META)?.crop ?? null;
}

export function writeSocialPreviewImageCrop(source: string, crop: SocialPreviewCrop | null): string {
  return writePreviewMeta(source, SOCIAL_PREVIEW_IMAGE_CROP_META, crop
    ? `<meta name="${SOCIAL_PREVIEW_IMAGE_CROP_META}" content="x=${crop.x};y=${crop.y};width=${crop.width}" />` : null);
}

export function imageCropMaxWidth(sourceHeight: number): number {
  return Math.min(SOCIAL_PREVIEW_WIDTH, sourceHeight * SOCIAL_PREVIEW_WIDTH / SOCIAL_PREVIEW_HEIGHT);
}

export function defaultImageCrop(sourceHeight: number): SocialPreviewCrop {
  const width = imageCropMaxWidth(sourceHeight);
  return { x: (SOCIAL_PREVIEW_WIDTH - width) / 2, y: (sourceHeight - socialPreviewCropHeight(width)) / 2, width };
}

export function clampImageCrop(crop: SocialPreviewCrop, sourceHeight: number): SocialPreviewCrop {
  const maxWidth = imageCropMaxWidth(sourceHeight);
  const width = Math.min(maxWidth, Math.max(Math.min(SOCIAL_PREVIEW_MIN_CROP_WIDTH, maxWidth), crop.width));
  return { width, x: Math.min(Math.max(0, crop.x), SOCIAL_PREVIEW_WIDTH - width),
    y: Math.min(Math.max(0, crop.y), Math.max(0, sourceHeight - socialPreviewCropHeight(width))) };
}
