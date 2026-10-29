/** The native compiler's bundled Go toolset must be no older than the one the repo builds esbuild with (scripts/lib/esbuild-toolchain.mjs); read it from the binary's build info with `go version <binary>`. */
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
