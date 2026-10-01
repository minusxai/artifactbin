/** The validate type-checker: which compiler checks which tsconfig.
 *
 * The native TypeScript compiler (`tsgo`, @typescript/native-preview) checks the same tsconfigs with the
 * same flags about ten times faster than tsc; scripts/__tests__/check-local.test.mjs proves both report
 * the same errors at the same file:line. It runs wherever npm installed its platform binary — macOS and
 * Linux here and in CI — and tsc runs anywhere it did not, so a platform without a binary still checks.
 * The binary is spawned directly: its npm launcher only locates it, at the cost of another Node start.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

/** [tsconfig, build-info name]. Each config keeps its own build info; tsc keeps the ones the configs name. */
const CONFIGS = [['tsconfig.json', 'root'], ['services/utils/tsconfig.strict.json', 'utils-strict']];

export function nativeCompiler({ root, platform = process.platform, arch = process.arch }) {
  const exe = path.join(root, 'node_modules/@typescript', `native-preview-${platform}-${arch}`, 'lib', platform === 'win32' ? 'tsgo.exe' : 'tsgo');
  return existsSync(exe) ? exe : null;
}

export function typeCheckCommands({ root, node = process.execPath, platform = process.platform, arch = process.arch }) {
  const exe = nativeCompiler({ root, platform, arch });
  // tsgo's build info is not tsc's: separate files, so switching compilers never costs a cold run.
  return CONFIGS.map(([config, info]) => exe
    ? [exe, '--noEmit', '-p', config, '--tsBuildInfoFile', `node_modules/.cache/tsgo/${info}.tsbuildinfo`]
    : [node, 'node_modules/typescript/bin/tsc', '--noEmit', '-p', config]);
}
