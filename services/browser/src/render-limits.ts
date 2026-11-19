import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';

/**
 * WHAT ONE RENDER'S PAGE MAY USE, held from outside the page: each renderer process of a render browser (one per page:
 * every render has its own context) may reach `bytes` resident memory and `threads` threads (every worker is one), and
 * one past either is killed at once. Its page crashes and that render alone fails; every other render keeps its own
 * renderer (and checks their own browser), so nothing unrelated is lost. A renderer's V8 heap is capped as well
 * (`--js-flags`, local.ts), so a heap runaway stops inside the page before the poll sees it.
 *
 * Found by reading the process table, never asked of the page: the render browsers are the children of this process
 * whose command line carries their lane marker, and their renderers the descendants marked `--type=renderer`.
 */
export interface RenderLimits { bytes: number; threads: number }
export const RENDER_LIMITS: RenderLimits = { bytes: 1536 * 1024 * 1024, threads: 128 };
/** How often a busy render browser's renderers are measured. */
export const RENDER_LIMIT_POLL_MS = 250;

export interface ProcessRow { pid: number; ppid: number; bytes: number; threads: number | null; command: string }

/** The renderers of the browsers marked `marker` under `root` that are past `limits`. Pure. */
export function rendererPastLimits(rows: readonly ProcessRow[], marker: string, limits: RenderLimits, root: number): ProcessRow[] {
  const browsers = new Set(rows.filter((row) => row.ppid === root && row.command.includes(marker)).map((row) => row.pid));
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const past: ProcessRow[] = [];
  const walk = (pid: number, depth: number) => {
    if (depth > 6) return;
    for (const child of children.get(pid) ?? []) {
      if (child.command.includes('--type=renderer') && (child.bytes > limits.bytes || (child.threads !== null && child.threads > limits.threads))) past.push(child);
      walk(child.pid, depth + 1);
    }
  };
  for (const browser of browsers) walk(browser, 0);
  return past;
}

/** This machine's processes: `/proc` on Linux (memory and threads), `ps` elsewhere (memory). */
export async function processTable(): Promise<ProcessRow[]> {
  if (process.platform === 'linux') {
    const rows: ProcessRow[] = [];
    for (const name of await readdir('/proc').catch(() => [] as string[])) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const [status, cmdline] = await Promise.all([readFile(`/proc/${name}/status`, 'utf8'), readFile(`/proc/${name}/cmdline`, 'utf8')]);
        const field = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(status)?.[1] ?? 0);
        rows.push({ pid: Number(name), ppid: field('PPid'), bytes: field('VmRSS') * 1024, threads: field('Threads') || null, command: cmdline.replaceAll('\0', ' ') });
      } catch { /* gone since the listing */ }
    }
    return rows;
  }
  const out = await new Promise<string>((resolve) => execFile('ps', ['-A', '-o', 'pid=,ppid=,rss=,command='], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve(error ? '' : stdout)));
  return out.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), bytes: Number(match[3]) * 1024, threads: null, command: match[4]! }] : [];
  });
}
