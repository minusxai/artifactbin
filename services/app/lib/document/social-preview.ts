import { parse, type DefaultTreeAdapterMap } from 'parse5';

const SOCIAL_PREVIEW_IMAGE_CROP_META = 'artifactbin:og-image-crop';
const SOCIAL_PREVIEW_IMAGE_META = 'artifactbin:og-image';
const SOCIAL_PREVIEW_META = 'artifactbin:og-crop';
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

interface PreviewMeta { start: number; end: number; content: string | null; contentStart?: number; contentEnd?: number }
function cropMeta(source: string, name = SOCIAL_PREVIEW_META): { headEnd: number | null; element: PreviewMeta | null; crop: SocialPreviewCrop | null } {
  const document = parse(source, { sourceCodeLocationInfo: true });
  let headEnd: number | null = null;
  let element: PreviewMeta | null = null;
  const visit = (node: DefaultTreeAdapterMap['node'], inHead = false): void => {
    const head = inHead || node.nodeName === 'head';
    if ('tagName' in node) {
      if (node.tagName === 'head') headEnd = node.sourceCodeLocation?.endTag?.startOffset ?? null;
      if (head && node.tagName === 'meta' && node.attrs.some(attr => attr.name === 'name' && attr.value === name) && node.sourceCodeLocation) {
        element = { start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset, content: node.attrs.find(attr => attr.name === 'content')?.value ?? null, contentStart: node.sourceCodeLocation.attrs?.content?.startOffset, contentEnd: node.sourceCodeLocation.attrs?.content?.endOffset };
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child, head);
  };
  visit(document);
  const content = (element as PreviewMeta | null)?.content;
  return { headEnd, element, crop: content ? parseSocialPreviewCrop(content, name === SOCIAL_PREVIEW_IMAGE_CROP_META ? 1 : SOCIAL_PREVIEW_MIN_CROP_WIDTH) : null };
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
    // Keep the original identity and unrelated attributes when updating a meta.
    if (markup && found.element.contentStart !== undefined && found.element.contentEnd !== undefined) {
      const content = /content="[^"]*"/.exec(markup)?.[0];
      if (content) return source.slice(0, found.element.contentStart) + content + source.slice(found.element.contentEnd);
    }
    return source.slice(0, found.element.start)
      + (markup ?? '')
      + source.slice(found.element.end);
  }
  if (!markup) return source;
  if (found.headEnd !== null) return source.slice(0, found.headEnd) + markup + source.slice(found.headEnd);
  // Missing heads are valid HTML. Insert an explicit one after the authored
  // doctype/html opener, preserving the original body and script bytes.
  const opener = /^(?:\s*<!doctype[^>]*>)?\s*(?:<html\b[^>]*>)?/i.exec(source)?.[0] ?? '';
  return source.slice(0, opener.length) + `<head>${markup}</head>` + source.slice(opener.length);
}

/** The uploaded image takes precedence over framing, which stays saved. */
export function socialPreviewImageValue(source: string): string | null {
  return cropMeta(source, SOCIAL_PREVIEW_IMAGE_META).element?.content ?? null;
}

export function socialPreviewImage(source: string): string | null {
  const value = socialPreviewImageValue(source);
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
