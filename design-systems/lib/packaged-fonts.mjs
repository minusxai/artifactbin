/** The install-generated manifest owns font binaries and their full descriptors. No web requests. */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {REPO} from './pages.mjs';
export function packagedFontFaces(families){
 const manifest=JSON.parse(readFileSync(path.join(REPO,'services/app/lib/data/story/story-font-manifest.json'),'utf8'));
 return [...new Set(families)].flatMap(family=>{
  const faces=manifest.systems[family];
  if(!faces?.length)throw Error(`Design-system font ${family} is not packaged; run npm ci.`);
  return faces.map(face=>{
   if(!/^\/fonts\/[a-z0-9-]+\.[a-f0-9]{8}\.woff2$/.test(face.url))throw Error('Invalid packaged font path');
   return `@font-face { font-family: ${JSON.stringify(family)}; font-style: ${face.style}; font-weight: ${face.weight};${face.stretch?` font-stretch: ${face.stretch};`:''} font-display: swap; src: url(${JSON.stringify('..'+face.url)}) format("woff2"); unicode-range: ${face.unicodeRange}; }`;
  });
 }).join('\n');
}
