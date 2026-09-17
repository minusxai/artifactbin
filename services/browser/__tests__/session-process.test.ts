import {expect,it} from 'vitest';
import {sessionSandboxPlan} from '../src/session-process';
it('launches SEA through its trusted selector with only the executable and browser tree mounted',()=>{
 const plan=sessionSandboxPlan('/tmp/private-session','/cache/chromium/chrome-linux64','/home/operator/bin/afbin',['--internal-browser-worker']);
 expect(plan.args).toContain('--unshare-all');expect(plan.args).toContain('--die-with-parent');expect(plan.args).toContain('--new-session');
 expect(plan.args.slice(-2)).toEqual(['/worker-executable','--internal-browser-worker']);
 expect(plan.args).toEqual(expect.arrayContaining(['--ro-bind','/home/operator/bin/afbin','/worker-executable']));
 expect(plan.args).not.toContain('/home/operator/bin');
 expect(plan.args).toEqual(expect.arrayContaining(['/cache/chromium/chrome-linux64','/browsers']));
 expect(plan.env).toEqual({HOME:'/home/session',TMPDIR:'/tmp',PATH:'/usr/bin:/bin',PLAYWRIGHT_BROWSERS_PATH:'/browsers',NODE_OPTIONS:'--max-old-space-size=128'});
});
it('retains the existing ordinary Node worker command by default',()=>{
 const plan=sessionSandboxPlan('/tmp/private-session','/cache/ms-playwright','/usr/bin/node');
 expect(plan.args.slice(-3)).toEqual(['/worker-executable','--max-old-space-size=128','/runtime/worker.mjs']);
});
