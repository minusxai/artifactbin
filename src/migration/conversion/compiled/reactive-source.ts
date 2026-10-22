import type {LocalReactiveExpression, ReadLocalReactiveExpression} from './reactive-source-contracts.ts';
const operators=new Set(['&&','||','===','!==','<','<=','>','>=']);
const reserved=new Set(['constructor','prototype','__proto__']);
const identifier=(name:unknown):name is string=>typeof name==='string'&&/^[A-Za-z_]\w*$/.test(name)&&!reserved.has(name);
/** Parse data, never evaluate source. This intentionally matches the archived
 * evaluator rather than JavaScript's wider operators or property semantics. */
export const readLocalReactiveExpression: ReadLocalReactiveExpression = (input) => {
  const signals=new Set<string>(),rowFields=new Set<string>();
  const read=(node:any,depth=0):LocalReactiveExpression|null=>{
    if(!node||typeof node!=='object'||depth>32)return null;
    if(node.type==='Literal'&&(node.value===null||['string','boolean'].includes(typeof node.value)||(typeof node.value==='number'&&Number.isFinite(node.value))))return {kind:'literal',value:node.value};
    if(node.type==='Identifier'&&typeof node.name==='string'&&/^\$[A-Za-z]\w*$/.test(node.name)&&!reserved.has(node.name.slice(1))){const name=node.name.slice(1);signals.add(name);return {kind:'signal',name};}
    if(node.type==='MemberExpression'&&!node.computed&&!node.optional&&node.object?.type==='Identifier'&&node.property?.type==='Identifier'&&identifier(node.property.name)){
      const field=node.property.name;
      if(node.object.name==='$_me'&&field==='id'){signals.add('_me.id');return {kind:'signal',name:'_me.id'};}
      if(node.object.name==='$_row'){rowFields.add(field);return {kind:'row',field};}
      if(/^\$[A-Za-z]\w*$/.test(node.object.name)&&!reserved.has(node.object.name.slice(1))){const name=node.object.name.slice(1)+'.'+field;signals.add(name);return {kind:'signal',name};}
    }
    if(node.type==='UnaryExpression'){
      const value=read(node.argument,depth+1);if(!value)return null;
      if(node.operator==='!')return {kind:'not',value};
      if(['-','+'].includes(node.operator)&&value.kind==='literal'&&typeof value.value==='number')return {kind:'literal',value:node.operator==='-'?-value.value:value.value};
    }
    if(['BinaryExpression','LogicalExpression'].includes(node.type)&&operators.has(node.operator)){
      const left=read(node.left,depth+1),right=read(node.right,depth+1);
      if(left&&right)return {kind:'binary',op:node.operator,left,right};
    }
    return null;
  };
  const expression=read(input);
  return expression?{expression,signals:[...signals],rowFields:[...rowFields]}:null;
};
