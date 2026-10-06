import {baseUrl,MARKDOWN_CONTENT_TYPE} from '@/lib/http';
import {publicGuideText} from '@/lib/serving/agent-references.server';

/** The canonical skill reference, readable without authentication or installed tooling. */
export async function GET(request:Request,{params}:{params:Promise<{topic:string}>}){
 const {topic}=await params;
 const text=publicGuideText(topic,baseUrl(request));
 return new Response(text??'Not found',{status:text===null?404:200,
  headers:{'Content-Type':MARKDOWN_CONTENT_TYPE,'Cache-Control':'no-store'},
 });
}
