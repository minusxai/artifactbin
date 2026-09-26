/** Detect removed implicit artifact names for diagnostics and the offline cutover. Never resolves artifacts. */
interface SqlToken { start: number; end: number; id: string; qualified: boolean; quoted?: boolean }

export function removedSqlReferenceTokens(sql: string): { tokens: SqlToken[]; diagnostic?: string } {
  const tokens: SqlToken[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      i++;let closed=false;
      while(i<sql.length){
        if(sql[i]==='\\')i+=2;
        else if(sql[i]==="'"&&sql[i+1]==="'")i+=2;
        else if(sql[i++]==="'"){closed=true;break;}
      }
      if(!closed)return {tokens,diagnostic:'unterminated SQL string'};
      continue;
    }
    if (c === '"') {
      const start=i++; let value=''; let closed=false;
      while(i<sql.length){if(sql[i]==='"'&&sql[i+1]==='"'){value+='"';i+=2;}else if(sql[i]==='"'){i++;closed=true;break;}else value+=sql[i++];}
      if(!closed)return {tokens,diagnostic:'unterminated quoted SQL identifier'};
      const match=/^ref_([A-Za-z0-9]{6,12})$/.exec(value);
      if(match)tokens.push({start,end:i,id:match[1],qualified:sql[i]==='.',quoted:true});
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') { i = sql.indexOf('\n', i + 2); if (i < 0) break; continue; }
    if (c === '/' && sql[i + 1] === '*') {
      let depth = 1; i += 2;
      while (i < sql.length && depth) { if (sql.startsWith('/*', i)) { depth++; i += 2; } else if (sql.startsWith('*/', i)) { depth--; i += 2; } else i++; }
      if (depth) return { tokens, diagnostic: 'unterminated SQL comment' };
      continue;
    }
    if (c === '$') { const opening=/^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i)); if(opening){const end=sql.indexOf(opening[0],i+opening[0].length);if(end<0)return {tokens,diagnostic:'unterminated dollar-quoted SQL string'};i=end+opening[0].length;continue;} }
    if ((i === 0 || !/[\w$]/.test(sql[i - 1])) && sql.startsWith('ref_', i)) {
      const match = /^ref_([A-Za-z0-9]{6,12})\b/.exec(sql.slice(i));
      if (match) { const end = i + match[0].length; tokens.push({ start: i, end, id: match[1], qualified: sql[end] === '.' }); i = end; continue; }
    }
    i++;
  }
  return { tokens };
}
