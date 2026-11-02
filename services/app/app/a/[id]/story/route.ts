/** Retired story fragments retain the raw reader's ACL and uniform refusal. */
import { GET as rawDocument } from '../raw/route';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return rawDocument(request, { params: ctx.params, fragment: true });
}
