import {escapeHtml} from '@artifactbin/utils/escape';
import {htmlPwaSettings} from './index';
import {parseSource,attribute,applyEdits,atHeadStart,removeElement} from './html-source';
/** Source-backed install presentation. Identity and scope are not author-controlled. */
export interface PwaSettings { enabled?: boolean; name?: string; shortName?: string; icon?: string; themeColor?: string; backgroundColor?: string }
const fields = { enabled: 'enabled', name: 'name', shortName: 'short-name', icon: 'icon', themeColor: 'theme-color', backgroundColor: 'background-color' } as const;
const valid = (key: keyof typeof fields, value: string | boolean) => key === 'enabled' ? typeof value === 'boolean' : typeof value !== 'string' ? false : key === 'icon' ? /^[a-zA-Z0-9]{6,12}$/.test(value)
  : key === 'themeColor' || key === 'backgroundColor' ? /^#[0-9a-fA-F]{6}$/.test(value)
  : value.trim().length > 0 && value.length <= (key === 'shortName' ? 30 : 100);
const metaName = (key: keyof typeof fields) => `artifactbin:pwa-${fields[key]}`;
const keys = Object.keys(fields) as Array<keyof typeof fields>;

export function readPwaSettings(source:string):PwaSettings{return htmlPwaSettings(source);}
/** Only direct head metadata is changed; body bytes and persistent IDs remain intact. */
export function writePwaSettings(source:string,settings:PwaSettings):string{
 for(const key of keys)if(settings[key]!==undefined&&!valid(key,settings[key]!))throw Error(`Invalid PWA ${key}`);
 const document=parseSource(source);
 const tags=keys.filter(key=>settings[key]!==undefined).map(key=>`<meta name="${metaName(key)}" content="${escapeHtml((key==='icon'?'ref:':'')+settings[key]!)}">`);
 const obsolete=document.elements.filter(element=>element.parentNode===document.head&&element.tagName==='meta'&&keys.some(key=>attribute(element,'name')===metaName(key)));
 return applyEdits(source,[...obsolete.map(element=>removeElement(source,element)),...(tags.length?[atHeadStart(document,tags)]:[])]);
}
