import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { openRegionDoc } from '../region-doc';
import { validateRegionUpdate } from '../validate';

it('refuses native XML updates at the legacy rich region boundary', () => {
  const server = openRegionDoc();
  const client = openRegionDoc(undefined, { clientId: 123 });
  const paragraph = new Y.XmlElement('paragraph');
  const text = new Y.XmlText();
  text.insert(0, 'Native trial text');
  paragraph.insert(0, [text]);
  client.getXmlFragment('tiptap-v1').insert(0, [paragraph]);
  expect(() => validateRegionUpdate('rich', server, Y.encodeStateAsUpdate(client), 123))
    .toThrow(expect.objectContaining({ code: 'outside_region' }));
  expect(server.getText('region').toString()).toBe('');
  client.destroy();
  server.destroy();
});
