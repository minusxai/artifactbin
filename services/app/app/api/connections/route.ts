import { connectorList } from '@artifactbin/connectors';
import { json } from '@/lib/http';
/**
 * GET: the built-in connectors, generated from the registry (`@artifactbin/connectors`): each one's group, label,
 * summary, fields (kind, required, secret, shown, default, choices) and whether this install runs it. Public: it
 * names what Artifactbin can connect to, never a connection.
 */
export function GET() {
  return json({ connectors: connectorList() }, 200, { 'Cache-Control': 'public, max-age=300' });
}
