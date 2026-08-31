/** One spelling per setting, and every name the proxy asks for is recorded — the boot notice names a typo that looks live. */
const asked = new Set<string>();

/** The names the proxy has read (server.ts's unknown-env audit merges these with the app's). */
export const proxyEnvNamesRead = (): ReadonlySet<string> => asked;

export const readEnv = (env: Record<string, string | undefined>, key: string): string | undefined => {
  asked.add(key);
  return env[key];
};
