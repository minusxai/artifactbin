import {expect,it} from 'vitest';
import {formatMarkupSource} from '../format-source';
it('formats tag spacing while preserving comments, prose, code, strings and node ids',()=>{
 const source='<Helmet><Query  name = "q" source = "ref:abc123">{`select \'<x>\',  2 from public.rows\n-- comment`}</Query><style>{`p { color: red; }`}</style></Helmet>\n{/* retained */}<p  id = "p001"  className = "a  b">  Exact text <strong>spaces</strong> stay.</p>';
 const fixed=formatMarkupSource(source);
 expect(fixed).toContain('<p id="p001" className="a  b">');
 expect(fixed).toContain('{/* retained */}');
 expect(fixed).toContain("{`select '<x>',  2 from public.rows\n-- comment`}");
 expect(fixed).toContain('{`p { color: red; }`}');
 expect(fixed).toContain('  Exact text <strong>spaces</strong> stay.');
 expect(formatMarkupSource(fixed)).toBe(fixed);
});
