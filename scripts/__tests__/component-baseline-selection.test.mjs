import {expect,it} from 'vitest';
import {browserParityFixtures} from '../fixtures/component-baseline/index.mjs';
import {selectBaselineFixtures,publishBaselineFixtures} from '../fixtures/component-baseline/publication.mjs';
it('keeps full catalogue by default and selects complete unchanged fixtures in catalogue order',()=>{
 expect(selectBaselineFixtures(browserParityFixtures)).toBe(browserParityFixtures);
 const selected=selectBaselineFixtures(browserParityFixtures,['slides-two','button']);
 expect(selected.map(fixture=>fixture.id)).toEqual(browserParityFixtures.filter(fixture=>['button','slides-two'].includes(fixture.id)).map(fixture=>fixture.id));
 expect(selected.find(fixture=>fixture.id==='slides-two')).toBe(browserParityFixtures.find(fixture=>fixture.id==='slides-two'));
});
it.each([[],['missing'],['slides-two','slides-two'],null,'slides-two',[1]])('rejects invalid requested coverage %j before publication',async fixtureIds=>{
 let writes=0;
 await expect(publishBaselineFixtures({implementation:'jsx',fixtureIds,publish:async()=>{writes++;return {id:'Page12'};}})).rejects.toThrow('fixture');
 expect(writes).toBe(0);
});
it('publishes only both themes of the requested whole fixture',async()=>{
 const bodies=[];const entries=await publishBaselineFixtures({implementation:'jsx',fixtureIds:['slides-two'],publish:async body=>{bodies.push(body);return {id:'Page12'};}});
 expect(entries.map(({fixture,theme})=>({fixture,theme}))).toEqual([{fixture:'slides-two',theme:'light'},{fixture:'slides-two',theme:'dark'}]);
 expect(bodies).toHaveLength(2);expect(bodies.every(body=>body.markup.includes('SlideDeck'))).toBe(true);
});
