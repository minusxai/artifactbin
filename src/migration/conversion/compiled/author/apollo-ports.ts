import { awaitAuthorAccess } from "./access.ts";
import type {
  AuthorPorts,
  QueryPort,
  AuthorState,
  AuthorMutationOptions,
} from "./contracts.ts";
import type { AfClient } from "../../../../apollo/apollo-contracts.ts";
import type { DocumentNode } from "graphql";
type AuthorData = {
  compiledPage?: Record<string, AuthorState>;
  authorSignals?: Record<string, AuthorState>;
};
/** The real core client and gql query; no parallel state store. */
export function authorApolloPorts(
  client: Pick<AfClient, "updateQuery" | "watchQuery">,
  query: DocumentNode,
  queries: (name: string) => QueryPort,
  mutations?: AuthorMutationOptions,
): AuthorPorts {
  return {
    state: {
      read(key) {
        let data: AuthorData | undefined;
        const snapshot = client
          .watchQuery<AuthorData>({ query })
          .subscribe((result) => {
            data = result.data;
          });
        snapshot.unsubscribe();
        return key.startsWith("value:")
          ? data?.compiledPage?.[key.slice(6)]
          : data?.authorSignals?.[key];
      },
      write(key, value) {
        client.updateQuery<AuthorData>({ query }, (data) =>
          key.startsWith("value:")
            ? {
                ...data,
                compiledPage: { ...data.compiledPage, [key.slice(6)]: value },
              }
            : {
                ...data,
                authorSignals: { ...data.authorSignals, [key]: value },
              },
        );
      },
      subscribe(listener) {
        const subscription = client.watchQuery({ query }).subscribe(listener);
        return () => subscription.unsubscribe();
      },
    },
    query: queries,
    ...(mutations
      ? {
          mutation: async (
            name: string,
            args: Readonly<import("./contracts.ts").Row>,
            row?: Readonly<import("./contracts.ts").Row>,
            signal?: AbortSignal,
          ) => {
            if (!mutations.names.includes(name))
              throw Error("Unregistered author mutation");
            const { context, epoch } = await awaitAuthorAccess(
              mutations,
              signal,
            );
            const current = () =>
              mutations.authorizationContext() === context &&
              (!mutations.access ||
                (mutations.access.read().state === "allowed" &&
                  mutations.access.read().epoch === epoch));
            if (signal?.aborted || !current())
              throw Error("Author mutation context changed");
            const result = await mutations.adapter.mutate(name, args, row);
            if (signal?.aborted || !current())
              throw Error("Author mutation context changed");
            return result;
          },
        }
      : {}),
  };
}
