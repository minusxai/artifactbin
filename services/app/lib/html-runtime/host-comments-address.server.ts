import {createHash} from 'node:crypto';
/**
 * The host comments module's pinned address (lib/document-serving/hosted-blocks): its digest under /af/v1/host/. The
 * runtime build bakes it into the host module (./build.server), the manifest names it: one rule, apart from the build,
 * which a production server replaces with its prebuilt assets (scripts/build/html-core.mjs).
 */
export const hostCommentsPath=(source:string)=>`/af/v1/host/${createHash('sha256').update(source).digest('hex')}.js`;
