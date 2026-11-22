// Visualization registry. Add a component: create web/viz/<name>.js that calls
// register('<name>', (el, spec, ctx) => {...}) and import it below.
export { registry, register, h, fmt } from './core.js';
import './core.js';
import './llm.js';
import './residual.js';
import './figure.js';
