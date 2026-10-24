import {fileURLToPath} from 'node:url';
import {buildComponentAssets} from '../lib/html-components-build.mjs';

const names=await buildComponentAssets({
  sourceDir:fileURLToPath(new URL('../../services/app/lib/html-components/',import.meta.url)),
  outputDir:fileURLToPath(new URL('../../services/app/skills/artifactbin/components/',import.meta.url)),
});
console.log(`Built ${names.length} HTML component modules with readable source and shared lazy ESM chunks.`);
