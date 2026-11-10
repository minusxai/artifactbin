/**
 * Native document metadata, asset addresses, CSP and durable annotation ranges. No I/O: persistence belongs to
 * lib/artifacts and publication to lib/publish. Keep the module below the browser bridge and persistence layers;
 * browser consumers enter through the leaves DEEP_MODULES['lib/document'] lists, everyone else through this index.
 */
export type { StoredContent } from './stored-content';

export { newEditId } from './splice';

export { assetUrlFor, canonicalAssetUrl, urlHash } from './asset-url';

export { displayTitle, firstHeadingTitle } from './title';
export type { SocialPreviewCrop } from './social-preview';
export { parseSocialPreviewCrop, socialPreviewCrop, socialPreviewImage, socialPreviewImageValue, clampImageCrop, savedSocialPreviewImageCrop, SOCIAL_PREVIEW_OVERVIEW_GENERATION } from './social-preview';
export type { CspDirective, CspExtensions, CspRequest } from './csp-extensions';
export {
  coversCspExtensions, CSP_DIRECTIVES, cspOriginMatches, EMPTY_CSP_EXTENSIONS, emptyCspExtensions, hasCspExtensions,
  mergeCspExtensions, parseCspOrigin, storedCspExtensions, subtractCspExtensions,
} from './csp-extensions';

export type { AnnotationRange } from './annotation-range';
export { canonicalQuote, canonicalText, isAreaRange, isTargetRange, parseAnnotationRange, parseRel, refinementRange } from './annotation-range';

export { isPersonMentionHref, personMentions } from './person-mentions';

export { authoringCapabilities } from './authoring-capabilities';
