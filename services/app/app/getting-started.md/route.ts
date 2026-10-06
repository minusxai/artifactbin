import { baseUrl, MARKDOWN_CONTENT_TYPE } from '@/lib/http';
import { gettingStartedMarkdown } from '@/lib/serving/getting-started';

export async function GET(request: Request) {
  return new Response(gettingStartedMarkdown(baseUrl(request)), {
    headers: { 'Content-Type': MARKDOWN_CONTENT_TYPE, 'Cache-Control': 'no-store' },
  });
}
