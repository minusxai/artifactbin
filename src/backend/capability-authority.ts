import {
  BackendHostError,
  type BackendHost,
  type BackendCapabilityHandler,
} from "./contracts.ts";
import type { ConfiguredResources } from "../connectors/config-contracts.ts";
import { ConnectorError } from "../connectors/json.ts";
export function withCapabilityAuthority(
  backend: BackendHost,
  configured: ConfiguredResources,
): BackendHost & { close(): Promise<void> } {
  const connectorHost = configured.host;
  const grants = configured.grants.map((g) => ({
    ...g,
    namedOperations: [...g.namedOperations],
  }));
  let closing: Promise<void> | undefined,
    closed = false;
  return {
    compile: (source, signal) =>
      closed
        ? Promise.reject(new BackendHostError("backend_unavailable"))
        : backend.compile(source, signal),
    invoke(request) {
      const {
        deployment,
        principal,
        signal,
        capabilityHandler: store,
      } = request;
      if (closed) return Promise.reject(new ConnectorError("CLOSED"));
      const actor = Object.freeze({
        tenant: principal.tenant,
        subject: principal.subject,
      });
      // Connector selectors may scope data by subject, so anonymous callers get no grants.
      const subject = actor.subject;
      const caller = Object.freeze({
        tenant: actor.tenant,
        subject: subject ?? "",
        grants: (subject === null ? [] : grants)
          .filter(
            (g) =>
              g.documentId === actor.tenant &&
              g.backendVersion === deployment.version,
          )
          .flatMap((g) =>
            g.namedOperations.map((operation) =>
              Object.freeze({ resource: g.resource, operation }),
            ),
          ),
      });
      if (deployment.runtime?.includes("/protocol@1/")) {
        if (caller.grants.length)
          return Promise.reject(new BackendHostError("deployment_invalid"));
        return backend.invoke({
          ...request,
          principal: actor,
          capabilityHandler: undefined,
        });
      }
      // The server handler owns store and explicit dataset bindings. Dataset
      // reads recheck their own audience; anonymous connector access stays denied.
      const handler: BackendCapabilityHandler = (ignored, request, s) =>
        request.kind === "store" || request.kind === "dataset"
          ? store
            ? store(ignored, request, s)
            : Promise.reject(new ConnectorError("DENIED"))
          : subject === null
            ? Promise.reject(new ConnectorError("DENIED"))
            : request.kind === "invoke"
              ? connectorHost.invoke(caller, request, s)
              : connectorHost.transaction(
                  caller,
                  request.resource,
                  request.operations,
                  s,
                );
      return backend.invoke({
        ...request,
        principal: actor,
        capabilityHandler: handler,
      });
    },
    close() {
      closed = true;
      return (closing ??= Promise.allSettled([
        Promise.resolve().then(() => connectorHost.close()),
        Promise.resolve().then(() =>
          (backend as BackendHost & { close?: () => Promise<void> }).close?.(),
        ),
      ]).then((results) => {
        if (results.some((result) => result.status === "rejected"))
          throw new BackendHostError("cleanup_failed");
      }));
    },
  };
}
