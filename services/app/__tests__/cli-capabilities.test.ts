import {expect,it} from 'vitest';
import {request} from './harness';
import {CLI_PROTOCOL_VERSION} from '@artifactbin/contracts';
import {STORY_THEME_NAMES,STORY_TEMPLATE_NAMES} from '@/lib/validation/atlas-schemas';
import {JSX_STORY_COMPONENT_NAMES} from '@/lib/jsx/components';
import {GET} from '@/app/api/capabilities/route';
it('advertises versioned authoring names and the write contract without authentication or database access',async()=>{
 const response=await GET(request('/api/capabilities'));expect(response.status).toBe(200);
 const body=await response.json();expect(body.protocol).toBe(CLI_PROTOCOL_VERSION);expect(body.allowlists.version).toBe(CLI_PROTOCOL_VERSION);
 expect(body.allowlists.themes).toEqual(STORY_THEME_NAMES);expect(body.allowlists.templates).toEqual(STORY_TEMPLATE_NAMES);expect(body.allowlists.components).toEqual(JSX_STORY_COMPONENT_NAMES);
 expect(body.reference).toBe('ref:<id>');
});
