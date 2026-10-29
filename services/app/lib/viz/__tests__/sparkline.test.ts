import {expect,it} from 'vitest';
import {renderSparklineSvg} from '..';
// Renders through the real headless Vega pipeline: this file's cost is Vega's, kept apart from the pure interface tests.
it('renders a fixed-size sparkline as standalone SVG (plus its 1px padding), empty series included',async()=>{
 const svg=await renderSparklineSvg([0,3,1,4],{width:60,height:12});
 expect(svg).toMatch(/^<svg[^>]*width="62" height="14"/);
 expect(svg).toContain('#3fe77b');
 expect(await renderSparklineSvg([])).toMatch(/^<svg[^>]*width="98" height="22"/);
});
