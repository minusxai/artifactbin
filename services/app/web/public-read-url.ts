import {appUrl} from './api-origin';
import {CARD_RENDER_GENERATION} from '@/lib/export-card';

/** Read bytes on main, where the scoped read session enforces private ACLs. */
export const publicReadUrl=(path:string):string=>appUrl(path);
export const artifactCardUrl=(row:{id:string;version?:number})=>publicReadUrl(`/a/${encodeURIComponent(row.id)}/export?format=jpg&mode=card&v=${encodeURIComponent(String(row.version))}&r=${CARD_RENDER_GENERATION}`);
