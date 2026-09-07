import React from 'react';
import {render} from '@testing-library/react';
import {parseJsx} from '@/lib/jsx';
import {renderStoryNodes} from '../interpreter';
describe('managed Iframe interpreter boundary',()=>{
  it('passes only compiled inert payload to the adapter; no author DOM enters parent',()=>{
    const calls:Record<string,unknown>[]=[];
    const Iframe=(props:Record<string,unknown>)=>{calls.push(props);return <div aria-label="managed-frame"/>;};
    const parsed=parseJsx('<Iframe id="1"><style>{`body{color:red}`}</style><canvas id="2"/><script>{`window.untrusted=true`}</script></Iframe>');
    if(!parsed.ok)throw Error(parsed.error);
    const result=render(<>{renderStoryNodes(parsed.nodes,{components:{Iframe}})}</>);
    expect(calls[0].compiled).toEqual({html:'<style>body{color:red}</style><canvas id="2"></canvas>',scripts:[{type:'classic',source:'window.untrusted=true'}]});
    expect(calls[0].children).toBeUndefined();
    expect(result.container.querySelector('canvas,style,script')).toBeNull();
    expect(calls[0].id).toBe('1');
  });
  it('fails closed for unvalidated forged platform props or unsafe child markup',()=>{
    for(const source of ['<Iframe compiled={{html:"evil"}}/>','<Iframe><iframe/></Iframe>']){
      const parsed=parseJsx(source);if(!parsed.ok)throw Error(parsed.error);
      const Iframe=()=>{throw Error('must not render');};
      expect(renderStoryNodes(parsed.nodes,{components:{Iframe}})).toEqual([null]);
    }
  });
});
