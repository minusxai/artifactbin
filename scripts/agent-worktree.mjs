#!/usr/bin/env node
/**
 * HAND A DELEGATED AGENT ITS OWN TREE. The orchestrator runs this, never the
 * agent: a git worktree on `split-<phase>`, a free 100-port block written to
 * `.env` (which `npm run dev` loads), and the brief at `.agent/BRIEF.md` with
 * that block appended — so the brief in the plan, the brief in the tree and
 * the env the servers boot with are one source. `.agent/` and `.env` can never
 * be committed (`info/exclude`, `.gitignore`).
 *
 *   node scripts/agent-worktree.mjs --phase p2 --brief ../p2-brief.md            # from the repo the agent works in
 *   node scripts/agent-worktree.mjs --phase p4 --brief b.md --pin-submodule services/artifactbin=<commit>
 *   node scripts/agent-worktree.mjs --phase p2 --remove                          # tear it down (branch kept)
 *
 * Options: --base <branch> (default simple-split) · --dir <path> (default ../<repo>-<phase>) · --install (npm install there)
 *          --from <port> (first block to try) · --secrets (append fresh AUTH__SECRET / CONTRACT__ACTOR_SECRET)
 *          --harness claude|codex|pi (print the exact launch line for that coding agent, lessons baked in)
 *
 * The launch lines ARE the CLAUDE.md "Coding agent lessons": codex needs
 * `< /dev/null` (it blocks on "Reading additional input from stdin"
 * otherwise) and `--approve-for-me` (implies workspace-write; `-s` cannot be
 * combined with it); pi takes the key by indirection so no value is ever
 * printed; claude runs through the Agent tool and reports by task notification.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const flag = (name) => process.argv.includes(name);
const git = (args, cwd = process.cwd()) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const phase = arg('--phase');
if (!phase) { console.error('--phase <name> is required'); process.exit(2); }

// The standard delegated-implementer prompt, and how each harness is launched
// on the seeded tree. One table: adding a harness is adding an entry, never
// new control flow. `FIREWORKS_API_KEY=$FIREWORKS_API_KEY` is indirection — a
// key VALUE is never printed; the orchestrator's environment supplies it.
const PROMPT = 'You are the delegated implementer for this worktree. Read CLAUDE.md, then .agent/BRIEF.md, and do exactly what the brief says, in its order. Finish by writing .agent/REPORT.md and then stop.';
const HARNESS_LAUNCH = {
  codex: (dir) => `codex exec -C ${dir} --approve-for-me "${PROMPT}" < /dev/null > ${dir}/.agent/RUN.log 2>&1; echo "exit=$?"`,
  pi: (dir) => `cd ${dir} && FIREWORKS_API_KEY=$FIREWORKS_API_KEY pi -p --no-session --model fireworks/accounts/fireworks/models/glm-5p3 "${PROMPT}" < /dev/null > .agent/RUN.log 2>&1; echo "exit=$?"`,
  claude: (dir) => `use the Agent tool with the worktree ${dir} and the prompt "${PROMPT}" — the report arrives as a task notification, but it must still write .agent/REPORT.md like everyone else.`,
};
const harness = arg('--harness');
if (harness && !(harness in HARNESS_LAUNCH)) {
  console.error(`--harness: unknown harness '${harness}' (valid: ${Object.keys(HARNESS_LAUNCH).join(', ')})`);
  process.exit(2);
}
const root = git(['rev-parse', '--show-toplevel']);
// The REPOSITORY's name, not this worktree's: from the common git dir (`.git` → its parent; a submodule's
// `.git/modules/<path>` → its basename), so a tree handed out from another worktree is still `<repo>-<phase>`.
const commonDir = path.resolve(root, git(['rev-parse', '--git-common-dir']));
const repoName = path.basename(commonDir) === '.git' ? path.basename(path.dirname(commonDir)) : path.basename(commonDir);
const dir = path.resolve(arg('--dir', path.join(root, '..', `${repoName}-${phase}`)));
const branch = `split-${phase}`;

if (flag('--remove')) {
  git(['worktree', 'remove', '--force', dir], root);
  console.log(`removed ${dir} (branch ${branch} kept)`);
  process.exit(0);
}

const brief = arg('--brief');
if (!brief || !fs.existsSync(brief)) { console.error('--brief <file> is required and must exist'); process.exit(2); }
const base = arg('--base', 'simple-split');

// 1. the tree
const exists = git(['branch', '--list', branch], root) !== '';
git(['worktree', 'add', ...(exists ? [] : ['-b', branch]), dir, exists ? branch : base], root);

// 2. a pinned submodule, when asked (prod hands the agent the OSS commit it builds on)
const pin = arg('--pin-submodule');
if (pin) {
  const [sub, commit] = pin.split('=');
  git(['submodule', 'update', '--init', sub], dir);
  git(['fetch', 'origin', commit], path.join(dir, sub));
  git(['checkout', '-q', '-B', base, commit], path.join(dir, sub));
}

// 3. the port block → .env
const env = execFileSync(process.execPath, [path.join(HERE, 'port-block.mjs'), '--env', '--from', arg('--from', '5000')], { encoding: 'utf8' });
const secrets = flag('--secrets')
  ? `AUTH__SECRET=${randomBytes(32).toString('base64url')}\nCONTRACT__ACTOR_SECRET=${randomBytes(32).toString('base64url')}\n`
  : '';
const relay = env.match(/MAIL_RELAY_PORT=(\d+)/)?.[1];
const mail = relay ? `EMAIL__RESEND_API_KEY=x\nEMAIL__RESEND_BASE_URL=http://127.0.0.1:${relay}\n` : '';
fs.writeFileSync(path.join(dir, '.env'), `${env}${secrets}${mail}`, { mode: 0o600 });

// 4. the brief, with the block appended, excluded from git for good
fs.mkdirSync(path.join(dir, '.agent'), { recursive: true });
fs.writeFileSync(path.join(dir, '.agent', 'BRIEF.md'), `${fs.readFileSync(brief, 'utf8').trimEnd()}\n\n## Your tree and ports\n\nWorktree: \`${dir}\` on branch \`${branch}\` (base \`${base}\`). Commit here; push \`${branch}\`; never touch \`${base}\` or another tree.\n\n\`\`\`\n${env}\`\`\`\n\nFinish by writing \`.agent/REPORT.md\` — what was seen RED, the counts, the commands run, the commit — and end it with a ===CONCISE=== section.\n`);
const common = git(['rev-parse', '--git-common-dir'], dir);
const exclude = path.join(path.isAbsolute(common) ? common : path.join(dir, common), 'info', 'exclude');
fs.mkdirSync(path.dirname(exclude), { recursive: true });
if (!fs.existsSync(exclude) || !fs.readFileSync(exclude, 'utf8').includes('.agent/')) fs.appendFileSync(exclude, '\n.agent/\n');

// 5. install, when asked
if (flag('--install')) spawnSync('npm', ['install', '--silent'], { cwd: dir, stdio: 'inherit' });

console.log(`${dir}  branch ${branch}  base ${base}${pin ? `  submodule ${pin}` : ''}\n${env.split('\n')[0]}\nbrief: ${path.join(dir, '.agent', 'BRIEF.md')}   env: ${path.join(dir, '.env')}`);
if (harness) console.log(`\nharness: ${harness}\n${HARNESS_LAUNCH[harness](dir)}`);
