import { createEnv, overHttp } from '@artifactbin/utils';
import type { SessionProcessOptions } from './session-process';

/** Browser-service environment boundary; these credentials never enter a worker. */
export function sessionProcessOptions(source: NodeJS.ProcessEnv): SessionProcessOptions | undefined {
  const { env } = createEnv(source);
  const target = env('BROWSER', 'SESSION_APP_URL');
  const baseURL = env('APP', 'PUBLIC_BASE_URL');
  const secret = env('CONTRACT', 'ACTOR_SECRET');
  if (!target || !baseURL || !secret) return undefined;
  return { baseURL, cgroupRoot: env('BROWSER', 'SESSION_CGROUP_ROOT'), request: overHttp(target, secret), ...(source.PLAYWRIGHT_BROWSERS_PATH ? { browsersPath: source.PLAYWRIGHT_BROWSERS_PATH } : {}) };
}
