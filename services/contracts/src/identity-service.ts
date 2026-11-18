/**
 * WHAT ANY READER LEARNS ABOUT WHO SOMEONE IS (cross-repository contract §2), in two parts:
 *
 *  - IDENTITY FACTS as SHARED READS: one thin view per identity table in the read schema (`IDENTITY_SCHEMA` by
 *    default, IDENTITY__SCHEMA), named as the table: the table as it is minus its secret columns, plus the rule columns
 *    (`users.active`, `tokens.scopes` and `tokens.live`, `sessions.live`). No filtering: a reader keeps
 *    `deleted_at IS NULL` itself. Every reader (this app, and any service granted the views) reads these and only
 *    these (the app's search_path resolves `users` to the view); in a split-role database each reader role holds USAGE
 *    on the schema and SELECT on its views, and nothing on the identity module's base tables (@artifactbin/auth
 *    identity-store).
 *  - PRESENTING A BEARER (`IDENTITY_INTROSPECT_PATH`): verifying a raw token needs its hash or the identity module's
 *    key, which no view exposes, so it stays a service-authenticated call (SERVICE_AUTH_HEADER) to the auth host. With
 *    INTERNAL__SERVICE_SECRET the answer covers every token; with a service's own introspection secret
 *    (./service-audiences) it covers only tokens bound to that service's audience, every other token answering
 *    `{active: false}`. JSON in and out, read from committed state at request time.
 *
 * THE PRINCIPAL (`IdentityIntrospectResponse` `principal_kind`, `group_id`, `group_role`, `issued_by`; the `tokens`
 * view's `group_id`, `group_role`, `issued_by`, `grant_id`): who a credential acts as. Today always a person: kind
 * `'user'`, `user_id` set and never null, the group fields null. Once group sign-ins exist a credential may act as a
 * group at a level (`'member'` or `'editor'`) with no person behind it; a reader checks `principal_kind` before
 * relying on `user_id` as the person acting.
 */
import type { ServiceTokenParent } from './service-audiences';
import { SERVICE_PAYLOAD_ENVELOPE, SERVICE_PAYLOAD_LIMIT } from './payload-limit';

export const IDENTITY_INTROSPECT_PATH = '/api/internal/identity/introspect';

/**
 * The introspection answer. `audience`: the origin the token is bound to (null: a general-purpose token of this
 * installation, which no other service may accept). `expires_at`: ISO time, null when it does not expire. `parent`: set
 * only on an exchanged token (./service-audiences `SERVICE_TOKEN_PATH`): the person's
 * own credential it was issued for, `token` (a `tokens` row) or `session` (a `sessions` row), which a service re-checks
 * by that id in the matching view (`live`). On an exchanged token `token_id` is the token's own id (`vtk_…`), never a
 * row of `tokens`.
 *
 * THE PRINCIPAL: who the token acts as. `principal_kind` is `'user'` on every active answer today, with `group_id`,
 * `group_role` and `issued_by` null: the principal is the person `user_id`. Once group sign-ins exist, a `'group'`
 * answer's principal is the group `group_id` itself at the level `group_role` (`'member'` or `'editor'`), with no
 * person behind it; `issued_by` is then the person who issued the credential, never the principal. A reader checks
 * `principal_kind` before relying on `user_id` as the person acting, and refuses a kind it does not handle. The
 * `tokens` view carries the same facts (`group_id`, `group_role`, `issued_by`, `grant_id`), all null on every row today.
 */
export type IdentityIntrospectResponse =
  | {
      active: true; principal_kind: IdentityPrincipalKind; user_id: string; token_id: string; scopes: string[]; audience: string | null;
      expires_at: string | null; parent: ServiceTokenParent | null; group_id: string | null; group_role: IdentityPrincipalGroupRole | null; issued_by: string | null;
    }
  | { active: false };
/** What an introspected token acts as: a person, or (once group sign-ins exist) a group at a level. */
export type IdentityPrincipalKind = 'user' | 'group';
/** The level a group principal acts at: never `admin`. */
export type IdentityPrincipalGroupRole = 'member' | 'editor';

/** The default read schema (IDENTITY__SCHEMA): where the identity views live. */
export const IDENTITY_SCHEMA = 'identity';

/**
 * Every identity view and its columns, in order: the cross-repository read contract (generated from the identity
 * module's table declarations minus its secret columns, @artifactbin/auth identity-store/views, which a test pins to
 * this literal). A column added at the end of a table is added at the end of its view, after its rule columns, so no
 * column a reader knows ever moves; anything else is a contract change on both sides.
 *  - users: every account row; `active` is "may sign in and act on this deployment" (Artifactbin's one rule).
 *  - tokens: access tokens, never their hash; `scopes` is the granted scope list; `live` is the bearer read's rule (row,
 *    expiry, OAuth family fence), an audience of this deployment's API or of a configured service
 *    (IDENTITY__SERVICE_AUDIENCES), and an active account. A reader accepting a token checks its `audience` itself.
 *    `group_id`, `group_role`, `issued_by`, `grant_id`: the principal columns (see `IdentityIntrospectResponse`), null
 *    on every row today; a row with a group principal will name its group, level, issuing person and approval.
 *  - groups (`parent_id` null at a root; `deleted_at` set once deleted), group_members (DIRECT rows only),
 *    group_hierarchy (one row, id 'installation': the revision moves on every group create, delete and reparent),
 *    group_invitations, handle_reservations, group_mail_outbox: the tables as they are.
 *  - sessions: Better Auth's browser sessions, never their token; `live` while unexpired.
 */
export const IDENTITY_VIEWS = {
  users: ['id', 'email', 'kind', 'parent_user_id', 'expires_at', 'merged_into_user_id', 'name', 'username', 'image_key', 'auto_accept_mentions', 'welcome_pending', 'test_account', 'created_at', 'active'],
  tokens: ['id', 'name', 'user_id', 'client_harness', 'audience', 'scope', 'request_authority', 'created_at', 'deleted_at', 'expires_at', 'last_used_at', 'scopes', 'live', 'group_id', 'group_role', 'issued_by', 'grant_id'],
  handle_reservations: ['handle', 'kind', 'subject_id'],
  groups: ['id', 'handle', 'name', 'description', 'created_by', 'created_at', 'deleted_at', 'parent_id'],
  group_hierarchy: ['id', 'revision', 'role_model_version'],
  group_members: ['group_id', 'user_id', 'role', 'created_at'],
  group_invitations: ['id', 'group_id', 'email', 'role', 'invited_by', 'created_at'],
  group_mail_outbox: ['id', 'email', 'recipient_id', 'group_id', 'group_name', 'handle', 'action', 'sender_id', 'lease_until', 'claim_token', 'attempts', 'next_attempt_at', 'quarantined_at', 'sent_at', 'created_at'],
  sessions: ['id', 'expiresAt', 'createdAt', 'updatedAt', 'ipAddress', 'userAgent', 'userId', 'live'],
} as const;

/** Purpose-only delegation, service-secret authenticated; never a public API bearer. */
export const ARTIFACT_READ_GRANT_PATH = '/api/internal/identity/artifact-read-grant';
export const ARTIFACT_READ_PATH = '/api/internal/identity/artifact-read';
/** Fixed app upstream route; only the identity owner calls it with a verified human actor. */
export const CANONICAL_ARTIFACT_READ_PATH = '/api/internal/artifact-read';
export interface IssuedArtifactReadGrant {grant:string; expires_at:string; user_id:string; audience:string}

/** The image equivalent of artifact-read: the same opt-in and grant, body `{grant, artifact_id, format?, element?, slide?}`. */
export const ARTIFACT_IMAGE_PATH = '/api/internal/identity/artifact-image';
/** Fixed app upstream route: POST `{artifact_id, format?, element?, slide?}` as the verified human; answers ArtifactImage. */
export const CANONICAL_ARTIFACT_IMAGE_PATH = '/api/internal/artifact-image';
/** The whole artifact-image call's bound at identity: a relay cuts a request at 35 s. */
export const ARTIFACT_IMAGE_DEADLINE_MS = 25_000;
/** The largest image an artifact-image or chart-image answer carries, before base64: its base64 and JSON stay under
 * SERVICE_PAYLOAD_LIMIT. */
export const ARTIFACT_IMAGE_BYTES = Math.floor((SERVICE_PAYLOAD_LIMIT - SERVICE_PAYLOAD_ENVELOPE) / 4) * 3;
/** An artifact-image answer: `data` is the image, base64; `bytes` its decoded length. */
export interface ArtifactImage {id:string; version:number; format:'png'|'jpg'; mime:'image/png'|'image/jpeg'; width:number; height:number; bytes:number; data:string}
/** The refusals identity passes through from the app seam, with the export door's own details; any other is 503 `image_unavailable`. */
export const ARTIFACT_IMAGE_ERRORS: Readonly<Record<string, number>> = {
  not_found: 404, element_not_found: 404, slide_not_found: 404, unknown_element: 400, unknown_format: 400, unknown_slide: 400,
  element_too_large: 422, too_large: 413, render_failed: 500, render_unavailable: 503,
};
/** The detail fields a passed-through refusal keeps. */
export const ARTIFACT_IMAGE_ERROR_FIELDS = ['error', 'element', 'found', 'slides', 'width', 'height', 'max', 'bytes', 'hint', 'allowed'] as const;

/** Purpose-only saved pinned evidence delegation, same service opt-in and arg_ grants as artifact-read. */
export const PAGE_EVIDENCE_PATH='/api/internal/identity/page-evidence';
/** Auth-only fixed seam. POST {operation}; then POST {operation,fingerprint} verifies metadata only. */
export const CANONICAL_PAGE_EVIDENCE_PATH='/api/internal/page-evidence';

/**
 * Purpose-only chart drawing for a trusted relay (the same `artifact_reads` opt-in and per-service introspection
 * secret as artifact-read, no grant: drawing reads no data, so a run with no personal grant may use it too). POST
 * exactly a subset of CHART_IMAGE_KEYS with `chart` and `rows`, at most SERVICE_PAYLOAD_LIMIT bytes. The identity
 * owner forwards that body to the fixed app seam and passes its status and JSON through, buffered to at most
 * SERVICE_PAYLOAD_LIMIT: `ChartImageWire`, or `{error, message, hint?}`.
 */
export const CHART_IMAGE_PATH = '/api/internal/identity/chart-image';
/** Fixed app upstream route; only the identity owner calls it. */
export const CANONICAL_CHART_IMAGE_PATH = '/api/internal/chart-image';
/** What a chart image request may carry; `chart` and `rows` are required. */
export const CHART_IMAGE_KEYS = ['chart', 'rows', 'width', 'height', 'theme', 'designSystem'] as const;
/** A drawn chart: base64 PNG bytes (`data`), its pixel size and byte count. */
export interface ChartImageWire {mime:'image/png'; width:number; height:number; bytes:number; data:string}
