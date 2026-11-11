/**
 * THE CONNECTORS (`@artifactbin/connectors`): the registry and the built-in connector modules behind the one
 * interface of contracts `Connection`. SERVER-ONLY: it opens sockets and holds secrets, so only a server composition
 * imports it (the app's lib/connections), never browser-bundled code. Adding a source is adding one module to
 * `MODULES` and its entry to contracts `CONNECTORS`.
 *
 * WHAT A DATABASE BEHIND A CONNECTION CAN RELY ON, whatever the statement says:
 *  - Sessions are read-only (`BEGIN READ ONLY` / `START TRANSACTION READ ONLY`, ended by ROLLBACK), one statement per
 *    query (extended protocol / multiple statements off), first keyword a read (./statement). A read-only
 *    transaction still runs functions with side effects: give the configured account read-only grants.
 *  - The viewer's values (contracts header) are set inside each query's own transaction, right before its statement,
 *    every time. They are advisory where the reader writes the SQL: a plain database cannot stop a statement that
 *    changes them (Postgres `set_config` is refused by name here, MySQL `:=`, `SET` and `INTO` too, but a function
 *    that runs SQL text gets past any such check). A gateway built for this reads them as the statement starts.
 *  - Addresses and TLS: ./network.
 */
import type { ConnectionConfig, ConnectorId, ConnectorNetworkPolicy, ConnectorSpec } from '@artifactbin/contracts';
import { CONNECTORS } from '@artifactbin/contracts';
import { connectorSpec, parseConnectionConfig } from './config';
import { ConnectorFailure } from './errors';
import type { ConnectorModule, OpenConnection } from './module';
import { mysqlConnector } from './mysql';
import type { NetworkSeams } from './network';
import { postgresConnector } from './postgres';

/** Each registered connector's module; one the install cannot run is absent (its configuration opens `unavailable`). */
const MODULES: Partial<Record<ConnectorId, ConnectorModule>> = { postgres: postgresConnector, mysql: mysqlConnector };

/** Opens a connection from its configuration (JSON text, an object, or one already checked). Sockets open on first use. */
export function openConnection(config: unknown, policy: ConnectorNetworkPolicy, seams?: NetworkSeams): OpenConnection {
  const checked: ConnectionConfig = parseConnectionConfig(config);
  const module = MODULES[checked.connector];
  if (!module) throw new ConnectorFailure('unavailable', `${connectorSpec(checked.connector)!.label} is listed but this install cannot connect to it yet`);
  return module.open(checked, policy, seams);
}

/** The registry as people and agents see it (the generated connector list): every connector, and whether it runs here. */
export function connectorList(): (ConnectorSpec & { available: boolean })[] {
  return CONNECTORS.map((spec) => ({ ...spec, available: !!MODULES[spec.id] }));
}

export { connectionSummary, parseConnectionConfig } from './config';
export { ConnectorFailure, connectorError } from './errors';
export { leadingWords, mapQualifiers, qualifierNames } from './statement';
export { checkedNamespace } from './answer';
export type { OpenConnection } from './module';
export type { NetworkSeams } from './network';
