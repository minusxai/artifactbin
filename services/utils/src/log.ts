/** One line per event: JSON in production (a collector reads it), readable elsewhere. The one env read utils makes. */
const json = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_ENV === 'production';
type Fields = Record<string, unknown>;
const line = (level: string, scope: string, msg: string, fields?: Fields) =>
  json ? JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...fields }) : `[${scope}] ${msg}${fields ? ' ' + JSON.stringify(fields) : ''}`;
export const log = (scope: string) => ({
  info: (msg: string, fields?: Fields) => console.log(line('info', scope, msg, fields)),
  warn: (msg: string, fields?: Fields) => console.warn(line('warn', scope, msg, fields)),
  error: (msg: string, fields?: Fields) => console.error(line('error', scope, msg, fields)),
});
