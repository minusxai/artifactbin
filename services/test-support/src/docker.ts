/**
 * Disposable Docker databases for the `integration` project's real-database proofs (vitest.config.ts
 * REAL_DATABASE_TESTS). CI's integration job pulls their images first (.github/workflows/ci.yml), so there a missing
 * image fails the suite instead of skipping it; on a machine without the image the suite skips.
 */
import { execFileSync, spawnSync } from 'node:child_process';

/** Whether `image` is local: false skips a suite, except under CI, where the image is provisioned and its absence throws. */
export function dockerImage(image: string): boolean {
  if (spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0) return true;
  if (process.env.CI) throw new Error(`${image} is not available: CI's integration job pulls it, so its suite must run there, never skip`);
  return false;
}

export interface DisposablePostgres {
  /** A superuser URL (`postgres`/`pw`) to the container's `postgres` database. */
  url: string;
  port: number;
  stop(): void;
}

/**
 * A fresh `postgres:17-alpine` on a loopback port, ready once it answers a query over TCP (the image's first start
 * listens on its socket only while it initializes). `args` are server flags (`-c name=value`).
 */
export async function startPostgres(args: string[] = []): Promise<DisposablePostgres> {
  const container = execFileSync('docker', ['run', '--rm', '-d', '-e', 'POSTGRES_PASSWORD=pw', '-p', '127.0.0.1::5432', 'postgres:17-alpine', ...args], { encoding: 'utf8' }).trim();
  const stop = () => { spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' }); };
  try {
    const port = Number(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim().split('\n')[0]!.split(':').at(-1));
    for (let attempt = 0; spawnSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-Atc', 'select 1'], { stdio: 'ignore' }).status !== 0; attempt++) {
      if (attempt >= 240) throw new Error('postgres:17-alpine never became ready');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { url: `postgres://postgres:pw@127.0.0.1:${port}/postgres`, port, stop };
  } catch (error) { stop(); throw error; }
}
