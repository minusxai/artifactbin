import type { SourceCodec } from "./contracts.ts";
import { decode, save } from "./codec.mjs";
export const codec: SourceCodec = { decode, save };
// Compile-time negative contract: invalid JSON may never be exported.
// @ts-expect-error undefined is not a JSON app state
save("", { format: 2, app: undefined, comments: [] });
// @ts-expect-error credentials are not an envelope field
save("", { format: 2, app: null, comments: [], accountToken: "forbidden" });
