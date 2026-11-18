import { connectorList } from '@artifactbin/connectors';
import { json } from '@/lib/http';
import { datasetsOwnConnections } from '@/lib/platform';
/**
 * GET: the built-in connectors, generated from the registry (`@artifactbin/connectors`): each one's group, label,
 * summary, fields (kind, required, secret, shown, default, choices) and whether this install runs it, and
 * `ownConnections`: whether a dataset may have its own connection here (DATASETS__OWN_CONNECTIONS; false: every such
 * door answers contracts `OWN_CONNECTIONS_OFF`). Public: it names what Artifactbin can connect to, never a connection.
 */
export function GET() {
  return json({ connectors: connectorList(), ownConnections: datasetsOwnConnections() }, 200, { 'Cache-Control': 'public, max-age=300' });
}
