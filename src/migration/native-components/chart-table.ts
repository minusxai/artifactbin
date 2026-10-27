/** Exact retained Question table presentation (islands/kit/data.tsx): up to
 * 200 rows, browser runtime locale, numeric maximumFractionDigits=2. */
export function nativeChartCellText(value:unknown):string{return typeof value==='number'?new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value):String(value??'');}
export function nativeChartVisibleRows<T>(rows:readonly T[]):T[]{return rows.slice(0,200);}

/** Plain read-only table used by the retained Chart table branch; never a sortable DataTable. */
export interface NativeChartPlainTable {
 readonly columns:readonly {readonly name:string;readonly type:string}[];
 readonly rows:readonly Readonly<Record<string,unknown>>[];
}
export interface NativeChartPlainTableDocument {createElement(tag:string):HTMLElement}

export function renderNativeChartPlainTable(doc:NativeChartPlainTableDocument,data:NativeChartPlainTable):HTMLElement {
 const make=(tag:string,classes:string)=>{const node=doc.createElement(tag);node.className=classes;return node;};
 const root=make('div','flex h-full w-full flex-col'),scroll=make('div','min-h-0 w-full flex-1 overflow-auto p-2'),table=make('table','w-full text-sm'),head=make('thead',''),header=make('tr','border-b border-border text-left text-muted-foreground'),body=make('tbody','');
 scroll.setAttribute('aria-label','Data table');
 for(const column of data.columns){const cell=make('th','px-2 py-1.5 font-medium');cell.textContent=column.name;header.append(cell);}
 for(const row of nativeChartVisibleRows(data.rows)){const tr=make('tr','border-b border-border/50');for(const column of data.columns){const cell=make('td',column.type==='number'?'px-2 py-1.5 text-right tabular-nums':'px-2 py-1.5');cell.textContent=nativeChartCellText(row[column.name]);tr.append(cell);}body.append(tr);}
 head.append(header);table.append(head,body);scroll.append(table);root.append(scroll);return root;
}
