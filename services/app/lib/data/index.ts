/**
 * lib/data: the on-disk story resources minusxai/artifactbin-server copies and reads by path (story-guidance.yaml,
 * and the font manifest scripts/copy-assets.mjs generates), so they stay at lib/data/story. The code that reads
 * them lives in lib/story-design.
 */
export { default as storyFontManifest } from './story/story-font-manifest.json';
