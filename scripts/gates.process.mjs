import { spawn } from 'node:child_process';

export const runGateProcess = (command, args, { timeoutMs, env = process.env }) => new Promise((resolve) => {
  const started_at = Date.now();
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  let output = '';
  let settled = false;
  let timedOut = false;
  let escalation;
  child.stdout.on('data', (b) => { output += b; });
  child.stderr.on('data', (b) => { output += b; });
  const done = (ok) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    clearTimeout(escalation);
    resolve({ ok, output, seconds: (Date.now() - started_at) / 1000 });
  };
  const timer = setTimeout(() => {
    const seconds = timeoutMs / 1000;
    output += `${output.endsWith('\n') ? '' : '\n'}timed out after ${seconds} s\n`;
    timedOut = true;
    child.kill('SIGTERM');
    // A retry owns the worker only after the previous process has closed.
    // Give signal handlers a bounded opportunity to release external resources.
    escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
  }, timeoutMs);
  child.on('close', (code) => done(!timedOut && code === 0));
  child.on('error', () => done(false));
});

