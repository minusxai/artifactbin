// Standard pinned Vega API. Use parse(spec, config, {ast:true}) with
// new View(runtime, {expr:expressionInterpreter}) when dynamic evaluation is blocked.
import {View as VegaView} from 'vega';
import {tooltipHandler} from './chart-tooltip';
export * from 'vega';
export { expressionInterpreter } from 'vega-interpreter';
export { tooltipHandler };
// Vega's View with the platform's themed tooltip as its default (chart-tooltip.ts) instead of the
// native `title` fallback. options.tooltip, or view.tooltip(fn), replaces it.
export class View extends VegaView {
  constructor(runtime, options = {}) { super(runtime, {...options, tooltip: options.tooltip ?? tooltipHandler()}); }
}
