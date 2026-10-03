import type { RemoteSessionInfo, RemoteView } from '../../../contracts/src/remote';
import type { RunnerJson } from '@artifactbin/contracts';
/** Installed only by a hosted deployment; absent in the OSS composition. */
export interface HostedRemoteAgent {
    owns(owner: string, id: string): boolean;
    ensure(owner: string): Promise<RemoteSessionInfo>;
    view(owner: string, id: string, since: number): Promise<RemoteView>;
    input(owner: string, id: string, text: string): Promise<void>;
    stop(owner: string, id: string): Promise<void>;
    operation(owner: string, requestId: string, operation: string, args: RunnerJson): Promise<Response>;
}
let hosted: HostedRemoteAgent | undefined;
export function setHostedRemoteAgent(value: HostedRemoteAgent | undefined) { hosted = value; }
export const hostedRemoteAgent = () => hosted;
