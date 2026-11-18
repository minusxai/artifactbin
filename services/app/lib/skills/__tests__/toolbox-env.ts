/** The environment a toolbox client under test is given: the server it targets, the fixture token, optionally its home. */
export const syntheticEnv = (server: string, home?: string) => ({ ARTIFACTBIN_URL: server, ARTIFACTBIN_TOKEN: 'synthetic', ...(home === undefined ? {} : { ARTIFACTBIN_HOME: home }) });
