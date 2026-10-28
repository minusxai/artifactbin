#!/usr/bin/env node
/**
 * THE RETIREMENT BUILD of @afbin/cli (0.6.0), and the whole package: every command (`afbin`, `afbin setup`,
 * `afbin --version`, `afbin update`, anything) prints where agents go now and exits 0. Connected 0.5.x CLIs
 * install it once the server advertises it (CLI__RETIREMENT=on, services/app/lib/platform/config.ts).
 * .github/workflows/release-cli.yml publishes it after main CI passes (ci.yml `cli-pack` packs and signs it).
 */
const AUTHOR_SKILL_URL = 'https://app.artefactbin.dev/skills/artifactbin.zip';
const UNINSTALL_COMMAND = 'npm uninstall -g @afbin/cli';

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify({ retired: true, skill_url: AUTHOR_SKILL_URL, npm: { status: 'manual', command: UNINSTALL_COMMAND } }) + '\n');
} else {
  process.stdout.write(
    `The artifactbin CLI (afbin) is retired. Agents now use the Artifactbin author skill: ${AUTHOR_SKILL_URL}\n` +
    `To install it, put the artifactbin/ folder from that zip in your agent's skills folder.\n` +
    `To remove afbin, run: ${UNINSTALL_COMMAND}\n`,
  );
}
process.exitCode = 0;
