/**
 * `-r` PRELOAD for the eval runner — runs BEFORE the ESM graph loads, which a
 * statement in run.ts cannot (imports are hoisted: story-templates.ts calls
 * storyGuidance() at module top level, which reads orchestrator/ from cwd).
 * THE APP'S CWD IS ITS PACKAGE DIR (P3 §B.4), so the runner starts there.
 */
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..', 'services', 'app'));
require(path.resolve(__dirname, '..', 'scripts', 'register-yaml.cjs'));
