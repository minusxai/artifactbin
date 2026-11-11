/** What one connector module is: `open` a checked configuration into a `Connection` (contracts). */
import type { Connection, ConnectionConfig, ConnectorAnswer, ConnectorLimits, ConnectorNetworkPolicy, ConnectorScalar } from '@artifactbin/contracts';
import type { NetworkSeams } from './network';

export interface OpenConnection extends Connection {
  /** Sessions open now (tests and the settings page's status). */
  sessions(): number;
}
export interface ConnectorModule {
  open(config: ConnectionConfig, policy: ConnectorNetworkPolicy, seams?: NetworkSeams): OpenConnection;
}
/** A connector's own catalog read: its SQL, unguarded, as no viewer. */
export type InternalRead = (text: string, params: Readonly<Record<string, ConnectorScalar>>, limits: Partial<ConnectorLimits>) => Promise<ConnectorAnswer>;
