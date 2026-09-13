/**
 * The installed flow's precondition is one `afbin auth` the driver runs and approves itself. Run
 * 34740707220 lost pi's scrolly before the agent started: the pairing was approved and the CLI's next
 * poll was answered "expired"; the driver failed the task on that one exchange and reported only the
 * CLI's stderr ("Skill installed: …"), not the JSON error on stdout. A second pairing is cheap; the
 * task's turn is not.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCliAuth } from '../lib/auth';

const fakeAfbin = (dir: string, script: string) => {
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, 'afbin');
  fs.writeFileSync(bin, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return dir;
};
const opts = (cliBin: string, homeDir: string, log: string[]) => ({
  cliBin, homeDir, harness: 'pi' as const, server: 'http://127.0.0.1:9', publicOrigin: 'http://127.0.0.1:9', cookie: 'c', timeoutMs: 5000,
  log: (m: string) => log.push(m),
});

describe('runCliAuth', () => {
  it('retries a failed pairing once, and the second attempt\'s success is the result', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-auth-'));
    try {
      const counter = path.join(root, 'count');
      const bin = fakeAfbin(path.join(root, 'bin'), `n=$(cat ${counter} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${counter}
if [ "$n" = "1" ]; then echo 'Skill installed: /x/skills/artifactbin' >&2; echo '{"error":{"code":"approval_expired","message":"Browser approval expired."}}'; exit 2; fi
echo '{"authenticated":true,"server":"http://127.0.0.1:9"}'`);
      const log: string[] = [];
      const result = await runCliAuth(opts(bin, root, log));
      expect(result.output).toContain('"authenticated":true');
      expect(fs.readFileSync(counter, 'utf8').trim()).toBe('2');
      expect(log.some((m) => /afbin auth attempt 1 failed \(2\)[\s\S]*approval_expired[\s\S]*retrying/.test(m)), log.join('\n')).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('fails after two attempts with BOTH streams in the message, so the JSON error is never hidden behind a stderr notice', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-auth-fail-'));
    try {
      const bin = fakeAfbin(path.join(root, 'bin'), `echo 'Skill installed: /x/skills/artifactbin' >&2; echo '{"error":{"code":"approval_expired","message":"Browser approval expired."}}'; exit 2`);
      const log: string[] = [];
      await expect(runCliAuth(opts(bin, root, log))).rejects.toThrow(/afbin auth failed \(2\) after 2 attempts:[\s\S]*approval_expired[\s\S]*Skill installed/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
