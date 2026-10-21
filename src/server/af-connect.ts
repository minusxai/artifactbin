/**
 * Pending connections of downloaded files to their pages (contract:
 * ./af-connect-contracts.ts). In memory: a connection waits at most `ttl`
 * for its approval and its one poll, and the grant itself is a session the
 * page service stores.
 */
import { randomBytes } from "node:crypto";
import { fail } from "../errors.ts";
import type {
  ConnectService,
  ConnectServiceOptions,
  PendingConnection,
} from "./af-connect-contracts.ts";

const text = (value: unknown, max: number): string =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : "";

export function createConnectService({
  pages,
  now = Date.now,
  random = (bytes) => randomBytes(bytes).toString("base64url"),
  ttl = 300_000,
  capacity = 20,
}: ConnectServiceOptions): ConnectService {
  const pending = new Map<string, PendingConnection>();
  let admitting = 0;
  function sweep(): void {
    for (const [key, entry] of pending) if (entry.expires <= now()) pending.delete(key);
  }
  function byDevice(deviceCode: unknown): PendingConnection {
    sweep();
    const entry = pending.get(text(deviceCode, 200));
    if (!entry) fail(410, "Connection request expired");
    return entry;
  }
  function byCode(code: unknown): PendingConnection {
    sweep();
    const wanted = text(code, 200);
    const entry = wanted ? [...pending.values()].find((candidate) => candidate.code === wanted) : undefined;
    if (!entry) fail(410, "Connection request expired");
    return entry;
  }
  return {
    async begin(fileId) {
      const id = text(fileId, 100);
      if (!id) fail(404, "Not found");
      sweep();
      if (pending.size + admitting >= capacity) fail(429, "Too many pending connections. Try again later.");
      admitting++;
      try {
        const page = await pages.connectInfo(id);
        const entry: PendingConnection = {
          code: random(6),
          deviceCode: random(32),
          fileId: page.id,
          expires: now() + ttl,
          grant: null,
          approving: false,
        };
        pending.set(entry.deviceCode, entry);
        return { status: 201, value: { code: entry.code, deviceCode: entry.deviceCode } };
      } finally {
        admitting--;
      }
    },
    info(code) {
      return { fileId: byCode(code).fileId };
    },
    async approve(credential, code) {
      const entry = byCode(code);
      if (entry.grant) fail(409, "Already approved");
      // The grant being issued may still fail, so this is not "approved" yet.
      if (entry.approving) fail(409, "Approval in progress, try again");
      entry.approving = true;
      try {
        const grant = await pages.grant(credential, entry.fileId);
        sweep();
        if (pending.get(entry.deviceCode) !== entry) {
          // Nothing can collect it any more: end the session rather than leave it live.
          await pages.revoke(grant.token).catch(() => {});
          fail(410, "Connection request expired");
        }
        entry.grant = grant;
        return { status: 200, value: { approved: true } };
      } finally {
        entry.approving = false;
      }
    },
    poll(deviceCode) {
      const entry = byDevice(deviceCode);
      if (!entry.grant) return { status: 202, value: { pending: true } };
      pending.delete(entry.deviceCode);
      return {
        status: 200,
        value: { token: entry.grant.token, username: entry.grant.username, purpose: "document" },
      };
    },
  };
}
