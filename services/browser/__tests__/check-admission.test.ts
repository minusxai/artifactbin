/**
 * WHO MAY HOLD THE CHECK BROWSER (./src/check-admission): one check per key in the lane, the lane's room, and each key's
 * hourly count and browser time, with refusals that spend nothing; and which renderers ./src/render-limits kills.
 */
import { expect, it } from 'vitest';
import { CHECK_LANE, createCheckAdmission } from '../src/check-admission';
import { rendererPastLimits, type ProcessRow } from '../src/render-limits';

it('admits one check per key, CHECK_LANE in all, and refuses past a key\'s hourly count or browser time, spending nothing on a refusal', () => {
  let now = 0;
  const admission = createCheckAdmission(() => now);
  const eve = { key: 'person:eve', perHour: 3, msPerHour: 10_000 }, team = { key: 'group:team', perHour: 10, msPerHour: 100_000 };
  const first = admission.admit([eve, team]);
  expect(first).not.toBeTypeOf('string');
  // Eve again, or anyone else in her group, while hers is in the lane.
  expect(admission.admit([eve])).toBe('busy');
  expect(admission.admit([{ key: 'person:ada', perHour: 3, msPerHour: 10_000 }, team])).toBe('busy');
  // The lane's room, filled by uncharged checks (the relay's).
  const others = Array.from({ length: CHECK_LANE.running + CHECK_LANE.waiting - 1 }, () => admission.admit([]));
  expect(others.every((other) => typeof other !== 'string')).toBe(true);
  expect(admission.admit([])).toBe('busy');
  for (const other of others) if (typeof other !== 'string') other.release();
  // Browser time is charged as the check ran: 9 s of Eve's 10.
  now += 9_000; if (typeof first !== 'string') first.release();
  const second = admission.admit([eve]);
  if (typeof second === 'string') throw new Error(second);
  now += 2_000; second.release();
  expect(admission.admit([eve])).toBe('rate_limited');
  // An hour later it is spent no more; and the count bites as well as the time.
  now += 60 * 60 * 1000;
  const quick = { key: 'person:quick', perHour: 2, msPerHour: 1e9 };
  for (let i = 0; i < 2; i++) { const one = admission.admit([quick]); if (typeof one === 'string') throw new Error(one); one.release(); }
  expect(admission.admit([quick])).toBe('rate_limited');
  expect(admission.admit([eve])).not.toBeTypeOf('string');
});

it('kills only the renderers of this service\'s marked render browsers that are past a limit', () => {
  const limits = { bytes: 100, threads: 10 };
  const rows: ProcessRow[] = [
    { pid: 10, ppid: 1, bytes: 1, threads: 1, command: 'chrome --artifactbin-render-lane=checks' },
    { pid: 11, ppid: 10, bytes: 1, threads: 1, command: 'chrome --type=zygote' },
    { pid: 12, ppid: 11, bytes: 500, threads: 5, command: 'chrome --type=renderer' },
    { pid: 13, ppid: 11, bytes: 50, threads: 50, command: 'chrome --type=renderer' },
    { pid: 14, ppid: 11, bytes: 50, threads: 5, command: 'chrome --type=renderer' },
    { pid: 15, ppid: 10, bytes: 900, threads: 90, command: 'chrome --type=gpu-process' },
    // A session's Chromium (not a child of this process with a lane marker) and another process's.
    { pid: 20, ppid: 2, bytes: 1, threads: 1, command: 'chrome --artifactbin-render-lane=checks' },
    { pid: 21, ppid: 20, bytes: 900, threads: 1, command: 'chrome --type=renderer' },
    { pid: 30, ppid: 1, bytes: 1, threads: 1, command: 'chrome' },
    { pid: 31, ppid: 30, bytes: 900, threads: 1, command: 'chrome --type=renderer' },
  ];
  expect(rendererPastLimits(rows, '--artifactbin-render-lane=checks', limits, 1).map((row) => row.pid)).toEqual([12, 13]);
  expect(rendererPastLimits(rows, '--artifactbin-render-lane=exports', limits, 1)).toEqual([]);
});
