import {it,expect} from 'vitest';
import {rejectLocalMutation} from '../read-only-operation';
it('preserves definite rejected outcomes for aliases and selected operation fragments',()=>{
 expect(rejectLocalMutation('query Read { __typename } mutation Write { ...Fields } fragment Fields on Mutation { shared:counter { add:increment } }','Write')).toMatchObject({data:null,extensions:{outcomes:{'shared.add':'rejected'}},errors:[{path:['shared','add']}]});
});
