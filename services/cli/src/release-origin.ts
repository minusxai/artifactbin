import {normalizeServer} from './config';
/** Releases are resolved through the selected host. */
export function releaseOrigin(server:string):string{return normalizeServer(server);}
