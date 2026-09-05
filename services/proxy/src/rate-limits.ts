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
 * ONE read, at boot: `proxyParts` builds the limiter when it is composed, so a file that does not exist or
 * does not parse is a REFUSAL TO BOOT, not a request that quietly meets built-in numbers.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { PolicyFile } from '@artifactbin/contracts/rate-limits';
import { validatePolicyFile } from '@artifactbin/utils/rate-limits';

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
  const tried: string[] = [];
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    tried.push(dir);
    const candidate = join(dir, DEFAULT_POLICY_FILE);
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`${DEFAULT_POLICY_FILE} was not found above ${tried[0]} — tried ${tried.join(', ')}`);
}

/**
 * `PROXY__RATE_LIMIT_CONFIG_FILE` if set (resolved against the process cwd when relative), else the default
 * above. Unset is a default, not a fallback: a path that IS set and does not exist is ENOENT at boot.
 */
export function resolvePolicyFilePath(env: Record<string, string | undefined>): string {
  const configured = env[POLICY_FILE_ENV]?.trim();
  if (configured) return isAbsolute(configured) ? configured : resolve(configured);
  return defaultPolicyFilePath();
}

/**
 * READ, PARSE, VALIDATE — once, at boot. A missing file, an unparseable file, an unknown policy name in a
 * route, a route with no policies, a regex that does not compile, an unknown key, a window that does not
 * parse: every one REFUSES with the offending line named. Never a silent fallback to built-in numbers.
 */
export function loadPolicyFile(path: string): PolicyFile {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`);
  }
  let doc: unknown;
  try { doc = parse(text); } catch (error) {
    throw new Error(`${path}: not valid YAML — ${(error as Error).message}`);
  }
  return validatePolicyFile(doc, path);
}
