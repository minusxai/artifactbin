/** What one connector module is: `open` a checked configuration into a `Connection` (contracts). */
import type { Connection, ConnectionConfig, ConnectorNetworkPolicy } from '@artifactbin/contracts/connectors';
import type { NetworkSeams } from './network';

/** Trusted operator read cap; never a public query option. */
export interface ConnectorReadPolicy { readonly queryTimeoutMs:number }

export interface OpenConnection extends Connection {
  /** Sessions open now (tests and the settings page's status). */
  sessions(): number;
}
export interface ConnectorModule {
  open(config: ConnectionConfig, policy: ConnectorNetworkPolicy, seams?: NetworkSeams, readPolicy?:ConnectorReadPolicy): OpenConnection;
}
