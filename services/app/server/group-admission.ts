/**
 * WHERE AN AGENT SIGNED IN AS A GROUP MAY GO (contracts `GroupActor`, identity-service `GROUP_SIGN_IN_RULE`): the app's
 * one admission list for it, checked at the app's edge (./app) before any door. A group's sign-in reaches exactly these
 * routes, whose handlers decide by lib/artifact-access's rule for it (a direct member of the group at its level and
 * nothing else); every other route answers 403 `group_principal_refused`, so a route added later refuses it until it
 * is reviewed and listed here. Its token reaches only the API and the reader's two read adapters beside it (download
 * and export) in the first place (the identity host's bearer admission).
 *
 * What is listed: reading what the group's members read (a page, its versions, its comments, its SQL and query doors),
 * creating in the group and replacing a page the group edits (at editor level; a member does neither, as a direct
 * Member may not), setting on both exactly what its twin may (a direct Editor of the group: `visibility`, `linkRole`
 * and a dataset's `access`, at creation and on a replace alike; never named `shares`, placement or a policy, which
 * stay with people), commenting and editing its own comments (its group's, at its level), a page's actions (its dataset mutations), the install's default connection, the event feed of what it
 * may observe (the watch every publish and comment tells an agent to start), and an image of a page it reads, or of
 * one chart, section or slide of it (the export, its capture reading as the group: lib/export read-key). What is not,
 * on purpose: everything personal (accounts, people, notifications, follows, likes, tokens, trash, drafts, test users,
 * browser sessions), everything of an owner or an Admin (delete, restore, transfer, sharing, members, policy,
 * connections, group administration), forks, regions, presence, reactions and uploads.
 */
import { GROUP_PRINCIPAL_REFUSED } from '@artifactbin/contracts';

/** Each admitted route: its method and its generated path pattern (server/routes.generated `path`). */
export const GROUP_ADMITTED_ROUTES: readonly (readonly [method: string, path: string])[] = [
  ['POST', '/api/artifacts'],
  ['GET', '/api/artifacts/:id'],
  ['PUT', '/api/artifacts/:id'],
  ['GET', '/api/artifacts/:id/versions'],
  ['GET', '/api/artifacts/:id/versions/:version'],
  ['GET', '/api/artifacts/:id/annotations'],
  // An image of a page it reads, or of one element or slide (`--format png --element SELECTOR`), read as the group:
  // the skill's address beside the reader (which the identity host admits a bearer to) and its API twin.
  ['GET', '/api/artifacts/:id/export'],
  ['GET', '/a/:id/export'],
  ['POST', '/api/artifacts/:id/annotations'],
  ['POST', '/api/artifacts/:id/annotations/:annId'],
  ['PATCH', '/api/artifacts/:id/annotations/:annId'],
  ['POST', '/api/artifacts/:id/mutate'],
  ['POST', '/api/artifacts/:id/query'],
  ['POST', '/api/artifacts/:id/sql'],
  ['GET', '/api/artifacts/:id/sql/schema'],
  ['POST', '/api/default-connection/sql'],
  // The comment and change feed, filtered to what the group's members may observe (lib/event-feed).
  ['GET', '/api/events'],
];

const compiled = GROUP_ADMITTED_ROUTES.map(([method, path]) => ({ method, pattern: new RegExp(`^${path.replace(/:[A-Za-z]+/g, '[^/]+')}/?$`) }));

/** Is this request one a group's sign-in may make? HEAD rides its GET. */
export function groupAdmitted(method: string, pathname: string): boolean {
  const asked = method === 'HEAD' ? 'GET' : method;
  return compiled.some((route) => route.method === asked && route.pattern.test(pathname));
}

/** The one refusal every other route answers a group's sign-in with. */
export const groupRefusal = (): Response => new Response(JSON.stringify({ error: GROUP_PRINCIPAL_REFUSED, message: 'This route does not accept a sign-in acting as a group.' }), { status: 403, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
