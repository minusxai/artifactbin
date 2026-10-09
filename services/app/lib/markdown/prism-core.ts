import './prism-manual';
import Prism from 'prismjs/components/prism-core';

if (typeof window !== 'undefined') {
  (window as Window & { Prism?: typeof Prism }).Prism = Prism;
}

export default Prism;
