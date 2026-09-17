import {expect} from 'vitest';
import {GET} from '@/app/a/[id]/export/route';
import {exportAssetResponse} from '@/lib/export/assets';
export const EXPORT_PNG=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==','base64'));
/** Follow the real redirect through the real asset handler; failures and editor previews stay direct. */
export async function exportImage(request:Request,context:Parameters<typeof GET>[1]):Promise<Response>{
 const response=await GET(request,context);
 if(response.status!==302)return response;
 expect(response.headers.get('cache-control')).toBe('no-store');
 const url=new URL(response.headers.get('location')!);
 expect(url.pathname).toMatch(/^\/assets\/export\//);
 return exportAssetResponse(new Request(url),url.pathname.split('/').at(-1)!);
}
