/** Pinned fontsource faces used by the live system covers. Latin ranges stay lazy; variable axes stay intact. */
import { packageFaces } from './fontsource-assets.mjs';
const PACKAGES = [
  {"family": "Archivo", "pkg": "@fontsource-variable/archivo", "css": ["standard-italic.css", "standard.css"]},
  {"family": "Archivo Narrow", "pkg": "@fontsource-variable/archivo-narrow", "css": ["wght.css"]},
  {"family": "Barlow", "pkg": "@fontsource/barlow", "css": ["400.css", "500.css", "600.css"]},
  {"family": "Barlow Condensed", "pkg": "@fontsource/barlow-condensed", "css": ["500.css", "700-italic.css", "700.css", "800.css"]},
  {"family": "Bricolage Grotesque", "pkg": "@fontsource-variable/bricolage-grotesque", "css": ["standard.css"]},
  {"family": "Cinzel", "pkg": "@fontsource-variable/cinzel", "css": ["wght.css"]},
  {"family": "Courier Prime", "pkg": "@fontsource/courier-prime", "css": ["400-italic.css", "400.css", "700.css"]},
  {"family": "DM Mono", "pkg": "@fontsource/dm-mono", "css": ["400.css", "500.css"]},
  {"family": "DM Sans", "pkg": "@fontsource-variable/dm-sans", "css": ["standard.css"]},
  {"family": "Fraunces", "pkg": "@fontsource-variable/fraunces", "css": ["full-italic.css", "full.css"]},
  {"family": "Fredoka", "pkg": "@fontsource-variable/fredoka", "css": ["standard.css"]},
  {"family": "Geist", "pkg": "@fontsource-variable/geist", "css": ["wght.css"]},
  {"family": "Geist Mono", "pkg": "@fontsource-variable/geist-mono", "css": ["wght.css"]},
  {"family": "IBM Plex Mono", "pkg": "@fontsource/ibm-plex-mono", "css": ["400-italic.css", "400.css", "500.css", "700.css"]},
  {"family": "Instrument Sans", "pkg": "@fontsource-variable/instrument-sans", "css": ["standard-italic.css", "standard.css"]},
  {"family": "Instrument Serif", "pkg": "@fontsource/instrument-serif", "css": ["400-italic.css", "400.css"]},
  {"family": "JetBrains Mono", "pkg": "@fontsource-variable/jetbrains-mono", "css": ["wght.css"]},
  {"family": "Libre Franklin", "pkg": "@fontsource-variable/libre-franklin", "css": ["wght.css"]},
  {"family": "Newsreader", "pkg": "@fontsource-variable/newsreader", "css": ["standard-italic.css", "standard.css"]},
  {"family": "Nunito", "pkg": "@fontsource-variable/nunito", "css": ["wght-italic.css", "wght.css"]},
  {"family": "Old Standard TT", "pkg": "@fontsource/old-standard-tt", "css": ["400-italic.css", "400.css", "700.css"]},
  {"family": "Pixelify Sans", "pkg": "@fontsource-variable/pixelify-sans", "css": ["wght.css"]},
  {"family": "Press Start 2P", "pkg": "@fontsource/press-start-2p", "css": ["400.css"]},
  {"family": "Space Mono", "pkg": "@fontsource/space-mono", "css": ["400-italic.css", "400.css", "700.css"]},
  {"family": "UnifrakturCook", "pkg": "@fontsource/unifrakturcook", "css": ["700.css"]},
  {"family": "VT323", "pkg": "@fontsource/vt323", "css": ["400.css"]},
];
export function designSystemFonts(assetUrl) {
  return PACKAGES.flatMap(({ family, pkg, css }) => css.flatMap(sheet => packageFaces(pkg, sheet)
    .filter(face => /-latin(?:-ext)?-/.test(face.file))
    .map(({ file, ...face }) => ({ ...face, family, url: assetUrl(pkg, file) }))));
}
