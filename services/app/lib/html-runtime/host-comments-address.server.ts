import {createHash} from 'node:crypto';
/**
 * A host module's pinned address (lib/document-serving/hosted-blocks): its digest under /af/v1/host/. The runtime build
 * bakes the comments module's into the host module and the code highlighter's into the comments module (./build.server),
 * the manifest names them: one rule, apart from the build, which a production server replaces with its prebuilt assets
 * (scripts/build/html-core.mjs).
 */
export const hostModulePath=(source:string)=>`/af/v1/host/${createHash('sha256').update(source).digest('hex')}.js`;
