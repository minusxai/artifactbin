import {renderDoc} from '@/lib/skills';
import {publishJsx} from '../jsx-tier';
import type {StoredContent} from '../input';
it('publishes the documented managed counter/canvas example unchanged on a second save',async()=>{
  const doc=renderDoc('artifactbin/references/markup-iframe.md','https://example.test');
  const sample=/```jsx\n([\s\S]*?)\n```/.exec(doc)?.[1];
  expect(sample).toBeTruthy();
  const saved=await publishJsx({},sample!);
  expect(saved).not.toBeInstanceOf(Response);
  expect((await publishJsx({},(saved as StoredContent).source!) as StoredContent).source).toBe((saved as StoredContent).source);
});
