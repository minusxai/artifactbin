/**
 * Disposable roots. Forty-odd CLI tests each opened `mkdtemp`, sometimes built a `home` and a `work`
 * beside it, and unwound the whole thing in a `finally`. That is this module.
 *
 * Runner-agnostic by construction: no `afterEach` registration, no global state. A caller either
 * disposes in its own `finally`, or hands the body to `withTempWorkspace` and lets it do so.
 */
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TempWorkspace {
  /** The directory that gets removed. */
  root: string;
  /** Where the CLI keeps its config and state store. */
  home: string;
  /** Where the caller's files live — a sibling of `home` under `split`, `root` itself under `shared`. */
  cwd: string;
  /** Idempotent; safe in a `finally` that may run twice. */
  dispose(): Promise<void>;
}

/**
 * `split` (the default) keeps the fake home out of the working directory, so a test can assert that a
 * command wrote nothing into the workspace. `shared` is the flatter shape — home and cwd are the same
 * directory — which several CLI tests rely on when they read a pulled file straight out of `home`.
 */
export async function tempWorkspace(prefix: string, layout: 'split' | 'shared' = 'split'): Promise<TempWorkspace> {
  const root = await mkdtemp(join(tmpdir(), prefix.endsWith('-') ? prefix : `${prefix}-`));
  const home = layout === 'shared' ? root : join(root, 'home');
  const cwd = layout === 'shared' ? root : join(root, 'work');
  if (layout === 'split') await Promise.all([mkdir(home), mkdir(cwd)]);
  let removed = false;
  return {
    root,
    home,
    cwd,
    dispose: async () => {
      if (removed) return;
      removed = true;
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** The same fixture with the `try`/`finally` written once. Returns whatever the body returns. */
export async function withTempWorkspace<T>(
  prefix: string,
  body: (workspace: TempWorkspace) => Promise<T>,
  layout: 'split' | 'shared' = 'split',
): Promise<T> {
  const workspace = await tempWorkspace(prefix, layout);
  try {
    return await body(workspace);
  } finally {
    await workspace.dispose();
  }
}
