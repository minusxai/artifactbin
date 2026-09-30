/** The compiled reader keeps its HTML-first boot, then adopts it in Solid. */
import { captureInstallPrompt } from '@/lib/pwa-install';
import stylesheet from './shell.css?url';
import { startSpaIdle } from './idle-boot';
import { restoreReloadedReader } from './restore-reader';

captureInstallPrompt(window);
void restoreReloadedReader();
startSpaIdle({ load: () => import('@/solid/main'), stylesheet });
