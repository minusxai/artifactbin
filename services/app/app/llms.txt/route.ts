import {baseUrl,MARKDOWN_CONTENT_TYPE} from '@/lib/http';
import {llmsText} from '@/lib/agent-discovery';

/** The served one-pager for an agent with nothing installed: what artifactbin is, install, connect, then the local skill. */
export async function GET(request:Request){
 return new Response(llmsText(baseUrl(request)),{
  headers:{'Content-Type':MARKDOWN_CONTENT_TYPE,'Cache-Control':'no-store'},
 });
}
