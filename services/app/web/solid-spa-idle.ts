/** The compiled reader keeps its HTML-first boot, then adopts it in Solid. */
import stylesheet from './shell.css?url';
import { startSpaIdle } from './idle-boot';
import { restoreReloadedReader } from './restore-reader';

void restoreReloadedReader();
startSpaIdle({ load: () => import('@/solid/main'), stylesheet });
