import { randomBytes } from "node:crypto";
import { hash } from "./text.ts";
import { policyFor, updatePolicy } from "../access.ts";
import { presenceUpdate, visiblePresence } from "../model.ts";
import { validateLoadedSnapshot } from "../comment-model.ts";
import { fail } from "../errors.ts";
import type {
  CollaborationOptions,
  CollaborationService,
  CollaborationResult,
} from "./collaboration-contracts.ts";
/** Transaction and permission boundary for sharing and presence. Follow-up reads
 * acquire their own connection only after authorization transactions have closed. */
export function createCollaborationService({
  repository,
  authority,
  presence,
  now = Date.now,
}: CollaborationOptions): CollaborationService {
  return {
    async authorizeLive(id, credential, sourceRevision) {
      return repository.authorize(id, hash(credential), async (loaded) => {
        const decision = authority.document(loaded, credential, id);
        return {
          file: { generation: loaded.document!.generation },
          actor: decision.actor,
          expires: loaded.session?.expires ?? Number.MAX_SAFE_INTEGER,
          sourceRevision,
          sourceAvailable: await loaded.sourceExists(sourceRevision),
        };
      });
    },
    async execute(id, credential, command) {
      if (command.kind === "permissions")
        return repository.authorize(id, hash(credential), async (loaded) => ({
          value: authority.document(loaded, credential, id).permissions,
        }));
      let afterCommit: (() => void) | undefined;
      let profiles: string[] | undefined;
      const result = await repository.run<CollaborationResult>(
        id,
        hash(credential),
        async (loaded) => {
          const { document: file, session } = loaded;
          const {
            actor,
            owner,
            permissions: grant,
          } = authority.document({ document: file, session }, credential, id);
          if (!file) fail(404, "File not found");
          let documentChanges: import("./collaboration-contracts.ts").CollaborationMutation<unknown>["documentChanges"];
          const execute = async (): Promise<CollaborationResult> => {
            switch (command.kind) {
              case "change-sharing":
              case "sharing": {
                authority.account(session);
                if (command.kind === "change-sharing") {
                  if (!grant.manage)
                    fail(403, "Only owners and editors can manage access.");
                  file.access = updatePolicy(
                    file,
                    command.policy,
                    command.expectedVersion,
                  );
                  documentChanges = { access: file.access };
                }
                const policy = policyFor(file);
                return {
                  value: {
                    policy: grant.manage ? policy : { ...policy, shares: {} },
                    permissions: grant,
                    url: null,
                    owner: file.owner,
                  },
                  ...(command.kind === "change-sharing"
                    ? { changed: "policy" as const }
                    : {}),
                };
              }
              case "profiles":
                profiles = [
                  actor,
                  ...visiblePresence(presence.get(id) || {}, {
                    now: now(),
                    generation: file.generation,
                  }).map((v) => v.actor),
                ].filter((v): v is string => !!v);
                return { value: null };
              case "update-presence": {
                if (!actor) fail(401, "Sign in to share presence");
                if (command.input.snapshot && command.input.shareView !== false)
                  validateLoadedSnapshot(
                    await loaded.sourceExists(
                      command.input.sourceRevision || "",
                    ),
                    command.input.snapshot,
                    command.input.sourceRevision || "",
                  );
                presenceUpdate(presence.get(id) || {}, actor, command.input, {
                  now: now(),
                  generation: file.generation,
                });
                // Ephemeral rooms can also change through WebSockets while the
                // repository awaits commit. Apply against the latest room, not a
                // pre-commit copy that would erase another viewer's update.
                afterCommit = () =>
                  presence.set(
                    id,
                    presenceUpdate(
                      presence.get(id) || {},
                      actor,
                      command.input,
                      {
                        now: now(),
                        generation: file.generation,
                      },
                    ),
                  );
                return {
                  value: { ok: true },
                  changed: "presence" as const,
                  generation: file.generation,
                };
              }
              case "presence":
                return {
                  value: {
                    viewers: visiblePresence(presence.get(id) || {}, {
                      now: now(),
                      generation: file.generation,
                    }),
                  },
                };
              case "revoke": {
                if (!owner)
                  fail(403, "Only owners and editors can revoke sharing");
                const share = randomBytes(32).toString("base64url");
                file.shareHash = hash(share);
                file.share = share;
                file.generation++;
                documentChanges = {
                  shareHash: file.shareHash,
                  share,
                  generation: file.generation,
                };
                return { value: { share }, changed: "revoked" as const };
              }
            }
          };
          const value = await execute();
          return {
            value,
            ...(documentChanges ? { documentChanges } : {}),
          };
        },
      );
      afterCommit?.();
      if (profiles) return { value: await repository.profiles(id, profiles) };
      if (command.kind === "sharing" || command.kind === "change-sharing")
        return {
          ...result,
          value: {
            ...(result.value as object),
            url: await repository.sharedLink(id),
          },
        };
      return result;
    },
  };
}
