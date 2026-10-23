import {it,expect} from 'vitest';
import {htmlPwaSettings} from '..';
it('reads bounded native install presentation without author-controlled identity or scope',()=>{
 expect(htmlPwaSettings('<html><head><meta name="artifactbin:pwa-enabled" content="true"><meta name="artifactbin:pwa-name" content="My &amp; app"><meta name="artifactbin:pwa-short-name" content="App"><meta name="artifactbin:pwa-theme-color" content="#112233"><meta name="artifactbin:pwa-icon" content="ref:Ab1234"><meta name="artifactbin:pwa-scope" content="/"></head><body></body></html>')).toEqual({enabled:true,name:'My & app',shortName:'App',themeColor:'#112233',icon:'Ab1234'});
});
it('ignores body, templates, script text and invalid settings',()=>{
 const source='<html><head><template><meta name="artifactbin:pwa-enabled" content="true"></template><script>const x="<meta name=artifactbin:pwa-enabled content=true>";</script><meta name="artifactbin:pwa-icon" content="https://example.com/icon.png"><meta name="artifactbin:pwa-theme-color" content="red"><meta name="artifactbin:pwa-short-name" content="'+ 'x'.repeat(31)+'"></head><body><meta name="artifactbin:pwa-enabled" content="true"></body></html>';
 expect(htmlPwaSettings(source)).toEqual({});
});
