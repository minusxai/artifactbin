import {describe,it,expect} from 'vitest';
import {renderDoc} from '../skills';
it('publishing routes authentication to local setup guidance without teaching self-minting',()=>{
 const doc=renderDoc('artifactbin/references/publishing.md','https://example.test');
 expect(doc).not.toContain('tokens/anonymous');
 expect(doc).toContain('publishing-auth.md');
});
describe('authentication guidance',()=>{
 it('names the private file, explicit setup and required browser approval',()=>{
  const doc=renderDoc('artifactbin/references/publishing-auth.md','https://example.test');
  for(const term of ['setup','~/.artifactbin/.env','Browser approval','--yes'])expect(doc).toContain(term);
 });
});
