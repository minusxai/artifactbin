/**
 * WHO the plugin is, and how a human installs it — the leaf of lib/plugin-package.
 *
 * Split out because it is the only part of the plugin story the BROWSER needs:
 * plugin-package renders the skill tree from disk, which a client component
 * quoting the install commands must not pull in. plugin-package re-exports
 * everything here, so it stays the one place to import from on the server.
 */
export const PLUGIN_NAME = 'artifact-bin';

/**
 * The public ORG marketplace (Anthropic's own claude-plugins-official
 * pattern): users add it once, install any minusx plugin from it. This repo's
 * CI owns the whole mirror while artifact-bin is the only plugin; the day a
 * second plugin publishes there, each repo syncs only its own
 * plugins/<name>/ subtree instead.
 */
export const PLUGIN_REPO = 'minusxai/minusx-plugins';
export const PLUGIN_REPO_URL = `https://github.com/${PLUGIN_REPO}`;

/** Codex App currently adds a marketplace from the plugin repository itself,
 * with an explicit branch, rather than from the shared Claude marketplace. */
export const CODEX_APP_PLUGIN_REPO_URL = 'https://github.com/minusxai/minusx-plugins';
export const CODEX_APP_PLUGIN_REF = 'master';

/** The marketplace's `name` — the user-facing install suffix (`artifact-bin@minusx`). */
export const MARKETPLACE_NAME = 'minusx';

/**
 * The two lines a human types into Claude Code. Quoted verbatim by the READMEs
 * plugin-package generates AND by the UI (/docs/human, the home-page pro tip),
 * so a rename of the repo or marketplace can't leave a dead command on a page.
 */
export const PLUGIN_INSTALL = `/plugin marketplace add ${PLUGIN_REPO}\n/plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
