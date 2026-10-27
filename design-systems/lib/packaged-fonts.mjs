/** The install-generated manifest owns font binaries and their full descriptors. No web requests.
 * Faces name the platform's /af/fonts/<name>.woff2 addresses (D17): no hash in the URL; the server maps each name to its file. */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {REPO} from './pages.mjs';
export function packagedFontFaces(families){
 const manifest=JSON.parse(readFileSync(path.join(REPO,'services/app/lib/data/story/story-font-manifest.json'),'utf8'));
 return [...new Set(families)].flatMap(family=>{
  const faces=manifest.systems[family];
  if(!faces?.length)throw Error(`Design-system font ${family} is not packaged; run npm ci.`);
  return faces.map(face=>{
   const name=/^\/fonts\/([a-z0-9-]+)\.[a-f0-9]{8}\.woff2$/.exec(face.url)?.[1];
   if(!name)throw Error('Invalid packaged font path');
   return `@font-face { font-family: ${JSON.stringify(family)}; font-style: ${face.style}; font-weight: ${face.weight};${face.stretch?` font-stretch: ${face.stretch};`:''} font-display: swap; src: url(${JSON.stringify(`/af/fonts/${name}.woff2`)}) format("woff2"); unicode-range: ${face.unicodeRange}; }`;
  });
 }).join('\n');
}
