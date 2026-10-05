import type { HostedRemoteAgent } from '@artifactbin/contracts';
export type { HostedRemoteAgent } from '@artifactbin/contracts';
let hosted: HostedRemoteAgent | undefined;
export function setHostedRemoteAgent(value: HostedRemoteAgent | undefined) { hosted = value; }
export const hostedRemoteAgent = () => hosted;
