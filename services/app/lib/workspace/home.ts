/**
 * The Home bootstrap: the effective homepage destination and the data that destination renders, in
 * one answer. Policy lives here (the explicit account preference, explicit Personal recovery, the
 * inherited company default, inherited Personal); the route only turns the result into HTTP.
 *
 * A group destination assembles its details and shelf concurrently and never reads the personal
 * shelf. Insights are a separate, slower read (`accountWorkspaceInsightsFor`) and are never part of
 * this answer, so they cannot delay a shelf. Membership is checked by both group reads: a group the
 * account cannot see resolves to `unavailable`, with neither details nor artifacts.
 */
import type { AccountPreferences, DeploymentState, GroupDetail } from '@artifactbin/contracts';
import { getDeploymentState } from '@/lib/deployment';
import { getAccountPreferences, getGroupDetail } from '@/lib/groups';
import { accountWorkspaceCoreFor, type AccountWorkspaceCore } from './dashboard';

type HomeDestination =
  | { kind: 'personal'; core: AccountWorkspaceCore }
  | { kind: 'group'; groupId: string; detail: GroupDetail; core: AccountWorkspaceCore }
  | { kind: 'unavailable'; groupId: string }
  | { kind: 'setup' };

export type HomeBootstrap =
  | { signedIn: false; deployment: DeploymentState }
  | { signedIn: true; accountId: string; deployment: DeploymentState; preferences: AccountPreferences; destination: HomeDestination };

/** The group a homepage opens: an explicit group, else (unless Personal is explicit) the deployment's default group. */
function destinationGroupId(preferences: AccountPreferences, deployment: DeploymentState): string | null {
  const chosen = preferences.default_destination;
  if (chosen.type === 'group') return chosen.id;
  if (chosen.type === 'personal') return null;
  return deployment.default_group?.id ?? null;
}

/** `personal` is the explicit `?personal=1` recovery: it wins over every saved or inherited destination. */
export async function homeBootstrapFor(user: { userId: string; email?: string | null } | null, options: { personal: boolean }): Promise<HomeBootstrap> {
  if (!user) return { signedIn: false, deployment: await getDeploymentState(null) };
  const { userId, email } = user;
  // Explicit Personal needs neither the preference nor the deployment to pick its shelf, so it loads alongside them.
  const [deployment, preferences, requested] = await Promise.all([
    getDeploymentState(userId), getAccountPreferences(userId), options.personal ? accountWorkspaceCoreFor(userId, email) : null,
  ]);
  const base = { signedIn: true as const, accountId: userId, deployment, preferences };
  if (requested) return { ...base, destination: { kind: 'personal', core: requested } };
  if (deployment.mode === 'company' && !deployment.setup_complete) return { ...base, destination: { kind: 'setup' } };
  const groupId = destinationGroupId(preferences, deployment);
  if (!groupId) return { ...base, destination: { kind: 'personal', core: (await accountWorkspaceCoreFor(userId, email))! } };
  const [detail, core] = await Promise.all([getGroupDetail(userId, groupId), accountWorkspaceCoreFor(userId, email, groupId)]);
  return { ...base, destination: detail && core ? { kind: 'group', groupId: detail.group.id, detail, core } : { kind: 'unavailable', groupId } };
}
