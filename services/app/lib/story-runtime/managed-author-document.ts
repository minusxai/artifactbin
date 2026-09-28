/**
 * The managed `<Iframe>`'s child document: a locked CSP (scripts inline only, assets from the managed asset
 * origin when one is configured) and the author-script bootstrap. Framework-free, shared by today's React
 * view (./managed-iframe) and the compiled page's island (lib/islands/kit/embed).
 */
import {AUTHOR_SCRIPT_BOOTSTRAP} from './author-script-bootstrap';

export function managedAuthorDocument(origin?:string):string {
  if(origin && (new URL(origin).origin!==origin||!/^https?:\/\//.test(origin)))throw Error('Invalid managed asset origin');
  const asset=origin?' '+origin:'';
  const csp=`default-src 'none'; script-src 'unsafe-inline'${asset}; connect-src${asset} blob: data:; img-src data: blob:${asset}; media-src data: blob:${asset}; font-src data:${asset}; style-src 'unsafe-inline'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'`;
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="'+csp+'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%}</style></head><body><script>'+AUTHOR_SCRIPT_BOOTSTRAP+'</script></body></html>';
}
