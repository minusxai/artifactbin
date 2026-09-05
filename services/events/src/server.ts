#!/usr/bin/env node
/**
 * THE EVENTS SERVICE AS A PROCESS: `node server` — the lean image's CMD.
 *   DATABASE_URL (required) · EVENTS__SCHEMA (events) · APP__PORT (8080) · INTERNAL__SERVICE_SECRET
 * Signals and exit codes are this file's; the boot is `runEvents`, which a
 * deployment wrapper calls with its own sinks and never imports this file.
 */
import { loadEventsConfig, runEvents } from './index';

const running = await runEvents(loadEventsConfig(process.env, { required: ['DATABASE_URL'] }));
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void running.close().then(() => process.exit(0)));
}
