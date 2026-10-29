/**
 * `npm run eval` needs the private eval suite copied into ./evals (see AGENTS.md). Without it,
 * tsx fails with a module-not-found stack trace that says nothing about the fix; this says it.
 */
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../evals/README.md', import.meta.url))) {
  console.error('evals/ is missing or stale. Copy it from ~/projects/artifactbin-evals/evals '
    + '(never symlink), then rerun npm run eval.');
  process.exit(2);
}
