import { createEnv, overHttp } from '@artifactbin/utils';
import type { SessionProcessOptions } from './session-process';

/**
 * WHERE THE SANDBOX IS DECIDED — once, at this service's env boundary, never by a
 * session asking the host what it happens to be.
 *
 * `BROWSER__SANDBOX=none` runs the session worker as a plain child process: no
 * bubblewrap, no cgroup, no OS containment at all. It exists for ONE reason — live
 * sessions cannot start on a developer's macOS host otherwise, so every CLI and skill
 * change waited on a release and a deploy to be tried at all. It is refused when
 * `NODE_ENV=production`, and any other value is refused outright rather than silently
 * ignored: a misspelled hardening switch must never read as "hardened".
 */
export interface SessionSandboxChoice {
  mode: 'bubblewrap' | 'none';
  /** Set when the setting was understood but not allowed; the spawn fails with this sentence. */
  refusal?: string;
}

export function sessionSandboxChoice(source: NodeJS.ProcessEnv): SessionSandboxChoice {
  const { env } = createEnv(source);
  const value = env('BROWSER', 'SANDBOX');
  if (value === undefined || value === '') return { mode: 'bubblewrap' };
  if (value !== 'none') return { mode: 'bubblewrap', refusal: `BROWSER__SANDBOX=${value} is not a setting this build knows; the only value is none, and only outside production.` };
  if (source.NODE_ENV === 'production') return { mode: 'bubblewrap', refusal: 'BROWSER__SANDBOX=none removes all OS containment from browser sessions and is refused when NODE_ENV=production.' };
  return { mode: 'none' };
}

export function sessionProcessPaths(source: NodeJS.ProcessEnv): Pick<SessionProcessOptions, 'cgroupRoot' | 'browsersPath' | 'sandbox'> {
  const { env } = createEnv(source);
  return { cgroupRoot: env('BROWSER', 'SESSION_CGROUP_ROOT'), sandbox: sessionSandboxChoice(source), ...(source.PLAYWRIGHT_BROWSERS_PATH ? { browsersPath: source.PLAYWRIGHT_BROWSERS_PATH } : {}) };
}

/** Browser-service environment boundary; these credentials never enter a worker. */
export function sessionProcessOptions(source: NodeJS.ProcessEnv): SessionProcessOptions | undefined {
  const { env } = createEnv(source);
  const target = env('BROWSER', 'SESSION_APP_URL');
  const baseURL = env('APP', 'PUBLIC_BASE_URL');
  const secret = env('CONTRACT', 'ACTOR_SECRET');
  if (!target || !baseURL || !secret) return undefined;
  return { baseURL, request: overHttp(target, secret), ...sessionProcessPaths(source) };
}
