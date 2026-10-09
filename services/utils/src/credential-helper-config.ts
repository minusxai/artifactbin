/** Standalone script settings: caller-selected state only; no service secrets. */
import {homedir} from 'node:os';
import {join} from 'node:path';
export function credentialHelperRoot(env:NodeJS.ProcessEnv=process.env):string{return env.ARTIFACTBIN_HOME||join(env.HOME||homedir(),'.artifactbin');}
