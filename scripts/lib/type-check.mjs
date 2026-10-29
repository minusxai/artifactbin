/** The validate type-checker: which compiler checks which tsconfig.
 *
 * TypeScript 7's native compiler checks the same tsconfigs with the same flags about four times faster than
 * tsc 5 (a GitHub runner, cold: 7s against 30s for the root config), which is what keeps pr-fast.yml's
 * `types` job inside its 60-second limit whatever the diff. scripts/__tests__/check-local.test.mjs proves both
 * report the same errors at the same file:line. Its platform packages are root optionalDependencies at one
 * exact version; it runs wherever npm installed the binary, and tsc 5 runs anywhere it did not, so a platform
 * without one still checks. The binary is spawned directly. tsc 5 stays installed for the tools that load its
 * JavaScript API.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

/** [tsconfig, build-info name]. The native compiler keeps its own build info (tsc 5's is another format). */
const CONFIGS = [['tsconfig.json', 'root'], ['services/utils/tsconfig.strict.json', 'utils-strict']];
/** The root config's native build info: pr-fast.yml's `types` job and ci.yml's `warm-caches` upload it as
 * the `tsgo-buildinfo` artifact, and scripts/ci/ci.mjs `type-info` restores the newest one. */
export const NATIVE_ROOT_BUILD_INFO = 'node_modules/.cache/tsgo/root.tsbuildinfo';

function nativeCompiler({ root, platform = process.platform, arch = process.arch }) {
  const exe = path.join(root, 'node_modules/@typescript', `typescript-${platform}-${arch}`, 'lib', platform === 'win32' ? 'tsc.exe' : 'tsc');
  return existsSync(exe) ? exe : null;
}

export function typeCheckCommands({ root, node = process.execPath, platform = process.platform, arch = process.arch }) {
  const exe = nativeCompiler({ root, platform, arch });
  return CONFIGS.map(([config, info]) => exe
    ? [exe, '--noEmit', '-p', config, '--tsBuildInfoFile', `node_modules/.cache/tsgo/${info}.tsbuildinfo`]
    : [node, 'node_modules/typescript/bin/tsc', '--noEmit', '-p', config]);
}
