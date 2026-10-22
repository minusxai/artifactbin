import { jsonCopy } from "../json.ts";
import { sameViewerRoster } from "./viewer-roster.ts";
import type {
  DocumentHost,
  DocumentHostOptions,
  DocumentHostSnapshot,
} from "./document-host-contracts.ts";
/** One owner for document binding, identity and the collaboration projection used by host adapters. */
export function createDocumentHost(options: DocumentHostOptions): DocumentHost {
  let snapshot: DocumentHostSnapshot = jsonCopy({
    session: options.initial?.session ?? null,
    username: options.initial?.username ?? null,
    permissions: jsonCopy(options.initial?.permissions ?? null),
    viewers: [],
    sync: "disconnected",
  });
  return {
    read: () => snapshot,
    connectionBinding() {
      const state = options.readState();
      return {
        origin: state.remote?.origin,
        fileId: state.fileId || undefined,
        // A downloaded file holds no capability; the frame takes the link's from the page.
        share: state.remote?.share || undefined,
        sourceRevision: state.sourceRevision,
        ...(options.version === undefined ? {} : { version: options.version }),
        sessionId: options.sessionId,
        source: options.source,
        requestId: state.publishRequest,
        sources: jsonCopy(state.sources || {}),
      };
    },
    transportConnection() {
      const state = options.readState();
      if (!state.remote || !state.fileId)
        throw Error("Publish this file with pagegi push first.");
      return {
        origin: state.remote.origin,
        fileId: state.fileId,
        token:
          typeof snapshot.session === "string"
            ? snapshot.session
            : state.remote.share,
        sourceRevision: state.sourceRevision,
        ...(options.version === undefined ? {} : { version: options.version }),
      };
    },
    commentAccess: () => ({
      active: options.gate.active,
      placement: options.hosted ? "hosted" : "portable",
      authenticated: !!snapshot.username,
      permission: snapshot.permissions?.comment ?? null,
    }),
    applyConnection(value) {
      if (!options.gate.active) throw Error("Document authority suspended");
      const identity = {
        session: value.session,
        username: value.username,
        origin: value.origin,
        ...(value.publication
          ? { publication: jsonCopy(value.publication) }
          : {}),
      };
      if (identity.publication) {
        const publication = identity.publication;
        options.updateState((state) => ({
          ...state,
          fileId: publication.fileId,
          remote: {
            origin: identity.origin,
            share: publication.share,
            head: publication.sourceRevision,
          },
        }));
      }
      options.invalidateCollaboration?.();
      snapshot = jsonCopy({
        ...snapshot,
        session: identity.session,
        username: identity.username,
        permissions: null,
        sync: "disconnected",
      });
      return { publicationChanged: !!identity.publication };
    },
    disconnectIdentity() {
      snapshot = jsonCopy({
        session: null,
        username: null,
        permissions: null,
        viewers: [],
        sync: "disconnected",
      });
    },
    observeCollaboration(status) {
      const owned = jsonCopy(status);
      const rosterChanged = !sameViewerRoster(snapshot.viewers, owned.viewers);
      const permissionsChanged =
        JSON.stringify(snapshot.permissions) !==
        JSON.stringify(owned.permissions);
      snapshot = jsonCopy({
        ...snapshot,
        viewers: owned.viewers,
        permissions: owned.permissions,
        sync: owned.sync,
      });
      return { rosterChanged, permissionsChanged };
    },
  };
}
