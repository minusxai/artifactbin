import './prism-manual';
import Prism from 'prismjs/components/prism-core.js';

if (typeof window !== 'undefined') {
  (window as Window & { Prism?: typeof Prism }).Prism = Prism;
}

export default Prism;
