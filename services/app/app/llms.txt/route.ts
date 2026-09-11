import {CLI_SKILLS_DOWNLOAD} from '@/lib/cli-release';
import {baseUrl,MARKDOWN_CONTENT_TYPE} from '@/lib/http';

/** Discovery only: authoring guidance ships in the versioned local bundle. */
export async function GET(request:Request){
 return new Response(`# artifactbin\n\nInstall: npm install -g @artifactbin/cli\nConnect: afbin setup --server ${baseUrl(request)}\nLocal reference: afbin help\n\nDownload local skills: ${CLI_SKILLS_DOWNLOAD}\n`,{
  headers:{'Content-Type':MARKDOWN_CONTENT_TYPE,'Cache-Control':'no-store'},
 });
}
