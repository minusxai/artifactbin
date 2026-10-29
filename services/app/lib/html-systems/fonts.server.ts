/**
 * D17: the platform's font files at /af/fonts/<name>.woff2, the name without a version or hash. The bytes live in
 * public/fonts under their content-hashed names (scripts/copy-assets.mjs, which also serves them at the legacy /fonts/
 * alias); the install-generated manifest maps each name to its one file. A name's bytes never change (the font-name
 * snapshot test pins that), so these answers are cached for a year as immutable. Only manifest names are admitted.
 */
import {lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import { storyFontManifest as manifest } from '@/lib/story-design/story-fonts';
import {PLATFORM_FONTS_PATH,platformFontName} from './index';

const faces=[...Object.values(manifest.families),manifest.app,...Object.values(manifest.systems)].flat() as Array<{url:string}>;
/** `<name>.woff2` → the hashed file under public/fonts. */
const files=new Map(faces.map(face=>[platformFontName(face.url)!,face.url.slice('/fonts/'.length)]));

/** The bytes of one /af/fonts/ path (or bare `<name>.woff2`), read from the package-cwd public/fonts; null when not registered. */
export function platformFontBytes(requested:string):Uint8Array|null{
 const name=requested.startsWith(PLATFORM_FONTS_PATH)?requested.slice(PLATFORM_FONTS_PATH.length):requested;
 const file=/^[a-z0-9-]+\.woff2$/.test(name)?files.get(name):undefined;
 if(!file)return null;
 const fonts=path.resolve('public/fonts'),full=path.resolve(fonts,file);
 if(!lstatSync(fonts).isDirectory()||lstatSync(fonts).isSymbolicLink()||!full.startsWith(fonts+path.sep)||lstatSync(full).isSymbolicLink())throw Error('Hosted fonts are unavailable');
 return new Uint8Array(readFileSync(full));
}

const cache=new Map<string,Uint8Array>();
export function platformFontResponse(request:Request,name:string):Response{
 let bytes=cache.get(name)??null;
 if(!bytes){bytes=platformFontBytes(name);if(bytes)cache.set(name,bytes);}
 if(!bytes)return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}});
 const headers={'content-type':'font/woff2','cache-control':'public, max-age=31536000, immutable','access-control-allow-origin':'*','x-content-type-options':'nosniff','content-length':String(bytes.byteLength)};
 return new Response(request.method==='HEAD'?null:Buffer.from(bytes),{headers});
}
