export function rowsCsv(rows:Record<string,unknown>[]):string{
 const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];
 const cell=(value:unknown)=>{const text=value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;};
 return [columns.map(cell).join(','),...rows.map(row=>columns.map(key=>cell(row[key])).join(','))].join('\n')+'\n';
}
