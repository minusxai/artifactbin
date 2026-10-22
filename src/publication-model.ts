import { fail } from "./errors.ts";
import { text } from "./model-values.ts";
import { normalizePath } from "./path-model.ts";
import type { SharedFile } from "./contracts.ts";
import {MAX_PAGE_SOURCE,utf8ByteLength} from './af-contracts.ts';
function pageSource(value:unknown):string{const source=text(value,MAX_PAGE_SOURCE);if(utf8ByteLength(source)>MAX_PAGE_SOURCE)fail(422,'Page source exceeds UTF-8 byte limit');return source;}
export const preparePublication: import("./publication-model-contracts.ts").PublicationPreparation =
  (existing, actor, request, options) => {
    if (!actor) fail(401, "Sign in required");
    const source = pageSource(request.source);
    text(request.requestId, 100);
    const revision = options.revision(source),
      old = existing;
    if (old) {
      if (old.sourceRevision !== revision) fail(409, "Publish request changed");
      return { file: null, publication: old, created: false };
    }
    const sources = { ...request.sources, [revision]: source };
    for (const [rev, content] of Object.entries(sources))
      if (options.revision(pageSource(content)) !== rev)
        fail(422, "Source revision mismatch");
    const publication = {
      fileId: options.fileId,
      sourceRevision: revision,
      share: options.share,
    };
    if (
      request.visibility &&
      !["private", "unlisted", "public"].includes(request.visibility)
    )
      fail(422, "Invalid visibility");
    if (
      request.linkRole &&
      !["viewer", "commenter", "editor"].includes(request.linkRole)
    )
      fail(422, "Invalid role");
    const file: SharedFile = {
      ...(request.path !== undefined
        ? { path: normalizePath(request.path) }
        : {}),
      owner: actor,
      access: {
        visibility: request.visibility || "private",
        linkRole: request.linkRole || "viewer",
        shares: {},
        version: 1,
      },
      shareHash: options.digest(options.share),
      share: options.share,
      generation: 1,
      head: revision,
      sources,
      comments: {},
      snapshots: {},
      sequence: 0,
    };
    return {
      file,
      publication,
      created: true,
    };
  };
