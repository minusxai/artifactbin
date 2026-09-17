/** Static file-reference positions shared by publication checks and rendered URL resolution. */
export const REFERENCE_POSITIONS:ReadonlyArray<{component:boolean;tag:string;attribute:string;kind:'image'|'pdf'|'file'|'asset';list?:boolean}>=[
 {component:false,tag:'img',attribute:'src',kind:'image'},
 {component:false,tag:'img',attribute:'srcset',kind:'image',list:true},
 {component:false,tag:'source',attribute:'srcset',kind:'image',list:true},
 {component:true,tag:'Video',attribute:'poster',kind:'image'},
 {component:false,tag:'video',attribute:'poster',kind:'image'},
 {component:true,tag:'File',attribute:'src',kind:'pdf'},
 {component:false,tag:'a',attribute:'href',kind:'asset'},
 {component:false,tag:'video',attribute:'src',kind:'file'},
 {component:false,tag:'audio',attribute:'src',kind:'file'},
 {component:false,tag:'source',attribute:'src',kind:'file'},
 {component:false,tag:'track',attribute:'src',kind:'file'},
];
