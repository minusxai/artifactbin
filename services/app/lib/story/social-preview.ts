import { parseJsx, type JsxElement } from '@/lib/jsx';
import { splitHelmet } from './helmet';

export const SOCIAL_PREVIEW_META = 'artifactbin:og-crop';
export const SOCIAL_PREVIEW_WIDTH = 1600;
export const SOCIAL_PREVIEW_HEIGHT = 840;
export const SOCIAL_PREVIEW_MIN_CROP_WIDTH = 400;

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
export function parseSocialPreviewCrop(content: string): SocialPreviewCrop | null {
  const match = /^x=(0|[1-9][0-9]*);y=(0|[1-9][0-9]*);width=(0|[1-9][0-9]*)$/.exec(content);
  if (!match) return null;
  const x = finiteInteger(match[1]);
  const y = finiteInteger(match[2]);
  const width = finiteInteger(match[3]);
  if (x === null || y === null || width === null) return null;
  if (width < SOCIAL_PREVIEW_MIN_CROP_WIDTH || width > SOCIAL_PREVIEW_WIDTH) return null;
  return { x, y, width };
}

const staticStringAttr = (element: JsxElement, name: string): string | null => {
  const attr = element.attributes.find((candidate) => candidate.name.toLowerCase() === name);
  return attr?.value.static && typeof attr.value.json === 'string' ? attr.value.json : null;
};

function cropMeta(source: string): { helmet: JsxElement | null; element: JsxElement | null; crop: SocialPreviewCrop | null } | null {
  const parsed = parseJsx(source);
  if (!parsed.ok) return null;
  const { helmet } = splitHelmet(parsed.nodes);
  const element = helmet?.children.find((child): child is JsxElement =>
    child.type === 'element'
    && !child.isComponent
    && child.tag.toLowerCase() === 'meta'
    && staticStringAttr(child, 'name') === SOCIAL_PREVIEW_META,
  ) ?? null;
  const content = element ? staticStringAttr(element, 'content') : null;
  return { helmet, element, crop: content === null ? null : parseSocialPreviewCrop(content) };
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
  const found = cropMeta(source);
  if (!found) return source;

  if (found.element) {
    return source.slice(0, found.element.start)
      + (crop ? directive(crop) : '')
      + source.slice(found.element.end);
  }
  if (!crop) return source;
  if (!found.helmet) return `<Helmet>${directive(crop)}</Helmet>${source ? `\n${source}` : ''}`;
  if (found.helmet.selfClosing) {
    return source.slice(0, found.helmet.start)
      + `<Helmet>${directive(crop)}</Helmet>`
      + source.slice(found.helmet.end);
  }
  const closing = `</${found.helmet.tag}>`;
  const at = found.helmet.end - closing.length;
  return source.slice(0, at) + directive(crop) + source.slice(at);
}
