/**
 * The environment a toolbox client under test is given: the server it targets and its token (the fixture `synthetic`
 * unless `token` names another; `null` gives none), optionally its home and a Claude Code session (`CLAUDECODE=1` with
 * that session id).
 */
export const syntheticEnv = (server: string, home?: string, { token = 'synthetic', claudeSession }: { token?: string | null; claudeSession?: string } = {}) => ({
  ARTIFACTBIN_URL: server,
  ...(token === null ? {} : { ARTIFACTBIN_TOKEN: token }),
  ...(home === undefined ? {} : { ARTIFACTBIN_HOME: home }),
  ...(claudeSession === undefined ? {} : { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: claudeSession }),
});
