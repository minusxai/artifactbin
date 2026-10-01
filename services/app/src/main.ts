import path from 'node:path';
import { serve } from '@artifactbin/utils';
import { AUTH_SECRET, BROWSER_SERVICE_URL, SQL_SERVICE_URL } from '@/lib/platform/config';
import { services } from '@/lib/platform/services';
import { installShutdown } from '@/lib/runtime/shutdown';
import { createAppServer } from '@/server/app';
import { getDb } from '@/lib/platform/db';
import { startAppBackgroundTasks } from '@/lib/runtime/app-background-tasks';

if (!SQL_SERVICE_URL || !BROWSER_SERVICE_URL) {
  throw new Error('this image carries no in-process engine or browser — set SQL__SERVICE_URL and BROWSER__SERVICE_URL');
}

const db = await getDb();
const stopBackgroundTasks = await startAppBackgroundTasks(db);
const port = Number(process.env.APP__PORT ?? '3000') || 3000;
const listening = serve(createAppServer({ actorSecret: AUTH_SECRET, webDir: path.resolve('dist/web') }), port, {
  host: process.env.HOSTNAME ?? '0.0.0.0',
});
// Node as PID 1 with no handler never sees SIGTERM: `docker stop` then waits
// its full timeout and SIGKILLs the process, losing whatever the events client
// had batched. Flush FIRST, then stop accepting.
installShutdown({
  steps: [stopBackgroundTasks, () => services().events.close?.() ?? Promise.resolve(), () => listening.close(), () => db.close()],
});
