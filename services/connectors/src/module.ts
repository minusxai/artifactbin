/** What one connector module is: `open` a checked configuration into a `Connection` (contracts). */
import type { Connection, ConnectionConfig, ConnectorNetworkPolicy } from '@artifactbin/contracts';
import type { NetworkSeams } from './network';

export interface OpenConnection extends Connection {
  /** Sessions open now (tests and the settings page's status). */
  sessions(): number;
}
export interface ConnectorModule {
  open(config: ConnectionConfig, policy: ConnectorNetworkPolicy, seams?: NetworkSeams): OpenConnection;
}
