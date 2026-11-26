import type {Plugin} from 'esbuild';
import {fileURLToPath} from 'node:url';
/** markdown-it's `entities` import as lib/markdown's slim decoder: the redirect scripts/lib/slim-entities.mjs gives every
 * other build of that module (a library cannot import the scripts layer), proved by build.test.ts. The runtime modules
 * (./build.server) and both trusted modules (./build-portable-chrome.server: comments read and write Markdown through
 * lib/markdown) use it. */
export const slimEntities:Plugin={name:'slim-entities',setup(builder){builder.onResolve({filter:/^entities$/},({importer})=>/[\\/]node_modules[\\/]markdown-it[\\/]/.test(importer)?{path:fileURLToPath(new URL('../markdown/entities.ts',import.meta.url))}:undefined);}};
