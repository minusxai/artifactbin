import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildComponentAssets} from '../lib/html-components-build.mjs';

/** Hosted component modules (served at /af/components/, imported as `@afbin/<name>`) and the skill's readable sources.
 * The legacy wrappers (`legacy`) are served for pages that already load them by URL; the skill ships no source for them,
 * nor for the internal registration helper. */
export async function buildHostedComponents(){
  const app=new URL('../../services/app/',import.meta.url);
  const hosted=JSON.parse(readFileSync(new URL('lib/html-components/hosted.json',app),'utf8'));
  return buildComponentAssets({
    receipt:{root:fileURLToPath(new URL('../../',import.meta.url))},
    sourceDir:fileURLToPath(new URL('lib/html-components/',app)),
    // The internal registration helper is platform plumbing, not part of any element's contract.
    entries:[...hosted.components,...hosted.legacy],readableEntries:hosted.components,readableOmit:['register-component'],
    outputDir:fileURLToPath(new URL('lib/build-assets/components/',app)),
    readableDir:fileURLToPath(new URL('skills/artifactbin/components/',app)),
  });
}
if(import.meta.url===`file://${process.argv[1]}`){
  const names=await buildHostedComponents();
  console.log(`Built ${names.length} hosted HTML component modules with shared lazy ESM chunks and their readable sources.`);
}
