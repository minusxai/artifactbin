import {toHonoPath} from '../../services/app/scripts/generate-routes.mjs';
import {it,expect} from 'vitest';
it('matches generated HTTP routes from Windows path separators',()=>{
 expect(toHonoPath('api\\artifacts\\[id]')).toBe('/api/artifacts/:id');
});
