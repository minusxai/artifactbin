/** Stable TypeScript validation, using the same tsconfigs on every platform.
 * The optional native preview bundles an unpatched Go runtime; installed leftovers are never reused.
 */
const CONFIGS = ['tsconfig.json', 'services/utils/tsconfig.strict.json'];
export function typeCheckCommands({node=process.execPath}={}) {
 return CONFIGS.map(config=>[node,'node_modules/typescript/bin/tsc','--noEmit','-p',config]);
}
