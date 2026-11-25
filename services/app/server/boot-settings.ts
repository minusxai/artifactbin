/** Validate boot settings before starting Vite, the app host or the listener. */
import { readEnv } from '@artifactbin/auth';

export function bootMode(env: NodeJS.ProcessEnv): 'development' | 'production' {
  const production = env.NODE_ENV === 'production';
  if (production && !readEnv(env, 'AUTH__SECRET')) {
    throw new Error('[boot] AUTH__SECRET is required in production (sessions and the agent cookie must survive a restart). Generate one: openssl rand -base64 32 — or run: npm run setup');
  }
  if (production && !readEnv(env, 'APP__PUBLIC_BASE_URL')) {
    throw new Error('[boot] APP__PUBLIC_BASE_URL is required in production (every published link is minted from it). Set it to the URL people reach this on.');
  }
  // Every document is served on its own origin (lib/http/pages-origin): there is no other renderer to fall back to.
  if (!readEnv(env, 'APP__PAGES_HOST')) {
    throw new Error('[boot] APP__PAGES_HOST is required: every document is served on its own origin, <hex id>.<pages host>, framed by the app page. Development: APP__PAGES_HOST=lvh.me with APP__PUBLIC_BASE_URL=http://app.lvh.me:<port> — or run: npm run setup');
  }
  return production ? 'production' : 'development';
}
