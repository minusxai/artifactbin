import { showcaseImage } from "@/lib/showcase-image";
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return showcaseImage((await ctx.params).id);
}
