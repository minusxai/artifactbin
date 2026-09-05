/**
 * THE POLICY FILE, LOADED — the proxy's half of the rate limits: the yaml dependency, where the default file
 * lives, and the ONE read of it (at boot, once). The engine that uses the result is pure and lives in utils.
 *
 * WHY THE DEFAULT IS FOUND BY WALKING UP, not by `new URL('../default_rate_limits.yml', import.meta.url)`:
 * this module is BUNDLED, and the bundle does not sit where the source sits. MEASURED (planning, 2026-09-05,
 * `scripts/build-server.mjs` output run from each layout):
 *
 *   layout                                    ./x.yml   ../x.yml   upward `services/proxy/x.yml`
 *   source  services/proxy/src/*.ts           miss      HIT        HIT
 *   proxy image  /app/services/proxy/proxy.mjs  HIT     miss       HIT
 *   single image /app/server.mjs              miss      miss       HIT
 *
 * No single module-relative path hits in all three (the two images bundle to different depths), and the
 * upward walk needs no Dockerfile change: both images already `COPY services ./services`.
 *
 * SKELETON — every body throws `rate-limits: implement …`.
 */
import type { PolicyFile } from '@artifactbin/contracts/rate-limits';

/**
 * The only env name that points at a policy file.
 *
 * READ IT THROUGH `loadConfig`'s `env('PROXY', 'RATE_LIMIT_CONFIG_FILE')`, NOT through `src/env.ts`'s
 * `readEnv`. The proxy has TWO independent registries of "names asked for" — `env.ts`'s module-level
 * `asked` set (which `server.ts` merges into the co-hosted audit) and `config.ts`'s `createEnv`, and ONLY
 * the latter feeds `ProxyConfig.unknownNames`. MEASURED in planning: a name read through `readEnv` alone
 * is still reported as "set but nothing reads it" by the standalone proxy's boot notice.
 */
export const POLICY_FILE_ENV = 'PROXY__RATE_LIMIT_CONFIG_FILE';

/** The path, relative to whatever directory the walk is standing in, that identifies the package's default. */
export const DEFAULT_POLICY_FILE = 'services/proxy/default_rate_limits.yml';

/**
 * WHERE THE DEFAULT FILE IS. Walk up from this module's own directory until `services/proxy/
 * default_rate_limits.yml` exists — true in the source tree, in the lean proxy image and in the single
 * image (see the table above). Nothing found is a boot refusal naming the directories tried.
 */
export function defaultPolicyFilePath(): string {
  throw new Error('rate-limits: implement defaultPolicyFilePath');
}

/**
 * `PROXY__RATE_LIMIT_CONFIG_FILE` if set (resolved against the process cwd when relative), else the default
 * above. Unset is a default, not a fallback: a path that IS set and does not exist is ENOENT at boot.
 */
export function resolvePolicyFilePath(env: Record<string, string | undefined>): string {
  throw new Error('rate-limits: implement resolvePolicyFilePath');
}

/**
 * READ, PARSE, VALIDATE — once, at boot. A missing file, an unparseable file, an unknown policy name in a
 * route, a route with no policies, a regex that does not compile, an unknown key, a window that does not
 * parse: every one REFUSES with the offending line named. Never a silent fallback to built-in numbers.
 */
export function loadPolicyFile(path: string): PolicyFile {
  throw new Error(`rate-limits: implement loadPolicyFile (${path})`);
}
