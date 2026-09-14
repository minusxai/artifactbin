import { createEnv, overHttp } from '@artifactbin/utils';
import type { SessionProcessOptions } from './session-process';

export function sessionProcessPaths(source: NodeJS.ProcessEnv): Pick<SessionProcessOptions, 'cgroupRoot' | 'browsersPath'> {
  const { env } = createEnv(source);
  return { cgroupRoot: env('BROWSER', 'SESSION_CGROUP_ROOT'), ...(source.PLAYWRIGHT_BROWSERS_PATH ? { browsersPath: source.PLAYWRIGHT_BROWSERS_PATH } : {}) };
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
