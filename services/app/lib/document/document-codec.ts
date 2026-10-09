/** A stored document is its graph (lib/document/document-graph): data, never executable JSX.
 * Every other stored shape is retired; a row in one does not decode (lib/artifacts/servable).
 */
import {graphSource,type DocumentGraph} from './document-graph';
export type StoredDocument=DocumentGraph;
export function decodeDocument(document:StoredDocument):string {
 if(document?.schema===3&&document.kind==='graph')return graphSource(document);
 throw new Error('Unsupported document storage: only a graph decodes');
}
