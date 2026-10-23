/** Versioned extension to the pinned source-only codemod; authored scripts are never executed here. */
export const LEGACY_PARAMS_BRIDGE_VERSION = 'scalar-params-v1';
export function extendLegacyParamsCodemod(source:string):string {
 const marker="      if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier' || !isMx(callee.object, path)) return;";
 if(source.split(marker).length!==2)throw Error('Params codemod seam mismatch');
 source=source.replace('  // The mx bridge.',String.raw`
  traverse(ast,{MemberExpression(path){
    const node=path.node;
    if(node.computed||node.property.type!=='Identifier'||node.property.name!=='params'||!isMx(node.object,path))return;
    const member=path.parentPath,call=member?.parentPath;
    if(!member?.isMemberExpression()||member.node.object!==node||member.node.computed||!call?.isCallExpression()||call.node.callee!==member.node)note(statementOf(path).node.start!,'Scalar params bridge must be called directly');
  }});
  // The mx bridge.`);
 return source.replace(marker,String.raw`
      if(callee.type==='MemberExpression'&&!callee.computed&&callee.property.type==='Identifier'&&callee.object.type==='MemberExpression'&&!callee.object.computed&&callee.object.property.type==='Identifier'&&callee.object.property.name==='params'&&isMx(callee.object.object,path)){
        const method=callee.property.name,args=path.node.arguments,at=statementOf(path).node.start!;
        const fail=()=>note(at,'Unsupported scalar params bridge call');
        if(method==='get'||method==='set'){
          const name=args[0]?.type==='StringLiteral'?args[0].value:null,binding=name?registry.bind(name):null;
          if(!binding||binding.kind!=='value'||args.length!==(method==='get'?1:2)){fail();return;}
          if(method==='get')edits.push({start:path.node.start!,end:path.node.end!,text:binding.local+'()'});
          else edits.push({start:callee.start!,end:args[1].start!,text:binding.setter+'('});
          registry.applied.add('scalar params get/set compatibility');return;
        }
        if(method!=='subscribe'||![1,2].includes(args.length)){fail();return;}
        const selected=args.length===2;
        const callback=args[selected?1:0];
        if(!callback||!['ArrowFunctionExpression','FunctionExpression','Identifier'].includes(callback.type)){fail();return;}
        const list=selected?args[0]:null;
        const names=selected?(list?.type==='ArrayExpression'&&list.elements.every(e=>e?.type==='StringLiteral')?list.elements.map(e=>e.value):null):[...registry.kinds].filter(([name,kind])=>kind==='value').map(([name])=>name);
        if(!names||new Set(names).size!==names.length){fail();return;}
        const bindings=names.map(name=>registry.bind(name));
        if(bindings.some(b=>!b||b.kind!=='value')){fail();return;}
        const snapshot='{'+names.map((name,i)=>JSON.stringify(name)+':'+bindings[i].local+'()').join(',')+'}';
        registry.solid.add('createMemo');
        const adapter='(/* scalar-params-v1 */(listener)=>{let live=true,first=true;createMemo(()=>{const values='+snapshot+';if(first){first=false;'+(selected?'':'return;')+'}if(live)listener(values);});return ()=>{live=false;};})';
        edits.push({start:callee.start!,end:selected?args[1].start!:callee.end!,text:adapter+(selected?'(':'')});
        registry.applied.add(selected?'repair named scalar params subscription with initial selected map':'scalar params subscription without initial delivery');return;
      }
`+marker);
}
