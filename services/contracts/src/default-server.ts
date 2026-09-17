/**
 * The hosted deployment: where afbin talks when nothing selects a server, and the origin the app's
 * own copy assumes a fresh CLI already points at. The ONE spelling — the CLI re-exports it, and
 * prose that must name it (README.md) is checked against this line.
 */
export const DEFAULT_SERVER = 'https://app.artifactbin.dev';
