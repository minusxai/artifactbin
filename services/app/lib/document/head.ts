/**
 * WHAT A DOCUMENT'S HEAD DECLARES, browser-safe: the `<Helmet>` split and its checks, the dataflow
 * declarations it carries, the title, the lazy code a page loads, the PWA settings, the CSP origins it
 * adds and the social preview (crop and image). What server code outside this module imports.
 * Browser-bundled code imports the leaf files directly: the island and app bundlers cannot drop the
 * rest of a barrel.
 */
export { declarationsOf, declaresMutations, validateHelmet } from './helmet';
export { displayTitle, firstHeadingTitle } from './title';
export type { PwaSettings } from './pwa-settings';
export { readPwaSettings } from './pwa-settings';
export type { SocialPreviewCrop } from './social-preview';
export { parseSocialPreviewCrop, SOCIAL_PREVIEW_OVERVIEW_GENERATION, socialPreviewCrop, socialPreviewImage } from './social-preview';
