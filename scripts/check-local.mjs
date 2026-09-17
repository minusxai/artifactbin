/** Owning CLI/environment boundary for the two routine local checks. */
import path from 'node:path';
import { runCheck } from './lib/check-evidence.mjs';

const [label, ...raw] = process.argv.slice(2);
const reuse = raw.includes('--reuse');
const args = raw.filter(arg => arg !== '--reuse');
const node = process.execPath;
const commands = label === 'validate' && !args.length ? [
  [node, 'scripts/check-residual-names.mjs'],
  [node, 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json'],
  [node, 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'services/utils/tsconfig.strict.json'],
] : label === 'test' ? [[node, 'scripts/test-changed.mjs', ...args]] : null;
try {
  if (!commands) throw new Error('Expected validate [--reuse] or test [--reuse] [test options].');
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
  process.exitCode = runCheck({ root: path.resolve('.'), label, commands, env, refs, reuse });
} catch (error) { console.error(`[check] ${error.message}`); process.exitCode = 1; }
