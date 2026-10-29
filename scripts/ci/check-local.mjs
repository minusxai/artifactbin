/** Owning CLI/environment boundary for the two routine local checks. */
import path from 'node:path';
import { runCheck } from '../lib/check-evidence.mjs';
import { typeCheckCommands } from '../lib/type-check.mjs';

const [label, ...raw] = process.argv.slice(2);
const reuse = raw.includes('--reuse');
// `--part=types|lint` runs one half of validate: the pull request lane (.github/workflows/pr-fast.yml)
// runs the halves on separate runners so the root type check does not share four CPUs with knip.
const part = raw.find(arg => arg.startsWith('--part='))?.slice('--part='.length);
const args = raw.filter(arg => arg !== '--reuse' && !arg.startsWith('--part='));
const node = process.execPath;
const rootTypes = command => command[command.indexOf('-p') + 1] === 'tsconfig.json';
const validateCommands = [
  [node, 'scripts/ci/check-residual-names.mjs'],
  [node, 'scripts/ci/check-ui-primitives.mjs'],
  [node, 'scripts/ci/module-graph.mjs'],
  [node, 'scripts/ci/table-ownership.mjs'],
  // Unused files, exports, types and dependencies (knip.config.js names the entry points); a stale entry fails too.
  [node, 'node_modules/knip/bin/knip.js', '--no-progress', '--treat-config-hints-as-errors'],
  ...typeCheckCommands({ root: path.resolve('.'), node }),
].filter(command => part === undefined || (part === 'types') === rootTypes(command));
const commands = label === 'validate' && !args.length && [undefined, 'types', 'lint'].includes(part) ? validateCommands
  : label === 'test' ? [[node, 'scripts/ci/test-changed.mjs', ...args]] : null;
try {
  if (!commands) throw new Error('Expected validate [--reuse] [--part=types|lint] or test [--reuse] [test options].');
  // npm lifecycle/terminal bookkeeping changes across shells; application and
  // tool settings remain part of the fingerprint. Only digests are persisted.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(npm_lifecycle_event|npm_lifecycle_script|npm_command|npm_config_argv|PWD|OLDPWD|SHLVL|_|TERM|COLORTERM|COLUMNS|LINES)$/.test(key)));
  // Explicit ref selection must also invalidate when the ref advances.
  const refs = [];
  if (label === 'test') for (let i = 0; i < args.length; i++) {
    if (args[i] === '--files') break;
    if (args[i] === '-n' || args[i] === '--max') { i++; continue; }
    if (!args[i].startsWith('-')) refs.push(args[i]);
  }
  if (label === 'test' && !refs.length && !args.includes('--files')) refs.push('HEAD');
  // A preview is not verification and must not produce a reusable pass.
  if (args.includes('--dry')) throw new Error('Agents should run npm test directly; discovery is already budgeted.');
  process.exitCode = await runCheck({ root: path.resolve('.'), label, commands, env, refs, reuse });
} catch (error) { console.error(`[check] ${error.message}`); process.exitCode = 1; }
