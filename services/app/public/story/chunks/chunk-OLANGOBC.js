import{c as B,d as A,r as y,t as C,u as R,w as V,x as k}from"./chunk-AXUDJ75R.js";function w(e,t){let r=j(t),n=Math.max(1,Math.ceil(e)),o=Math.min(n,r),a=Math.min(Math.ceil(n/o),r),s=Math.ceil(n/o/a);if(s>r)throw new Error(`WebGPU dispatch requires ${n} workgroups, exceeding the 3D dispatch limit of ${r} per dimension`);return{x:o,y:a,z:s}}function M(e,t="workgroupId"){return`((${t}.z * ${e.y}u + ${t}.y) * ${e.x}u + ${t}.x)`}function E(e,t,r="workgroupId",n="localId"){return`(${M(e,r)} * ${t}u + ${n}.x)`}function j(e){return Number.isFinite(e)&&e>0?Math.floor(e):65535}function _(e,t){switch(e){case"u32":return`${t}u`;case"f32":return Number.isInteger(t)?`${t}.0`:`${t}`;default:return`${t}`}}function F(e,t){switch(e){case"uint32":return _("u32",Math.trunc(t));case"sint32":return`${Math.trunc(t)}`;case"float32":return _("f32",t);default:throw new Error(`WebGPU operations only support 32-bit output types, got ${e}`)}}function I(e){switch(e){case"uint32":return"0u";case"sint32":return"0";case"float32":return"0.0";default:throw new Error(`WebGPU operations only support 32-bit output types, got ${e}`)}}function f(e){switch(e){case"uint32":return"u32";case"sint32":return"i32";case"float32":return"f32";default:throw new Error(`WebGPU operations only support 32-bit storage types, got ${e}`)}}var O=64,Z="GPGPU Operation Counts",q="Computation Runs",X=new B;function m({module:e,elementWise:t=!1,expression:r,inputs:n,output:o,operationType:a=o.type,outputBuffer:s}){if(!e.source)throw new Error(`WebGPU computation ${e.name} requires WGSL source`);let l=te(n),i=l.map(([p,$])=>({name:p,input:$})),u=i.filter(({input:p})=>!p.isConstant).map((p,$)=>({...p,index:$})),c=f(a),d=f(o.type),x={TYPE:c,RESULT_LEN:o.size.toString()},h=w(Math.ceil(o.length/O),s.device.limits.maxComputeWorkgroupsPerDimension);for(let[p,$]of l)x[`${p.toUpperCase()}_LEN`]=$.size.toString();let v=`
${ne(e.source,x)}
${u.map(({name:p,input:$,index:D})=>K(p,$,D)).join(`
`)}
${i.map(({name:p,input:$})=>H(p,$,a)).join(`
`)}
${J(o,u.length)}
${Q(o)}

@compute @workgroup_size(${O}) fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>
) {
  let rowIndex = ${E(h,O)};
  if (rowIndex >= ${o.length}u) {
    return;
  }

${i.map(({name:p})=>`  let ${p} = read_${p}(rowIndex);`).join(`
`)}
  var result: array<${d}, ${o.size}>;
${ee(e.name,l,o,t,r)}
  write_result(rowIndex, result);
}
`,P=new y(s.device,{source:v,modules:e.dependencies,shaderAssembler:X,shaderLayout:{bindings:[...u.map(({name:p},$)=>({name:p,type:"storage",group:0,location:$})),{name:"result",type:"storage",group:0,location:u.length}]}}),N=Object.fromEntries(u.map(({name:p,input:$})=>[p,$.buffer]));N.result=s,P.setBindings(N);let W=s.device.beginComputePass({});s.device.statsManager.getStats(Z).get(q).incrementCount(),P.dispatch(W,h.x,h.y,h.z),W.end(),s.device.submit(),P.destroy()}function K(e,t,r){if(t.isConstant)return"";let n=f(t.type);return`@group(0) @binding(${r}) var<storage, read> ${e}: array<${n}>;`}function H(e,t,r){let n=f(r),o=t.type===r?"":n,a=t.stride/t.ValueType.BYTES_PER_ELEMENT,s=t.offset/t.ValueType.BYTES_PER_ELEMENT;return t.isConstant?`fn read_${e}(_rowIndex: u32) -> array<${n}, ${t.size}> {
  return array<${n}, ${t.size}>(${re(t,o)});
}`:`fn read_${e}(rowIndex: u32) -> array<${n}, ${t.size}> {
  var value: array<${n}, ${t.size}>;
  let rowOffset = ${s}u + rowIndex * ${a}u;
${Array.from({length:t.size},(l,i)=>o?`  value[${i}] = ${o}(${e}[rowOffset + ${i}u]);`:`  value[${i}] = ${e}[rowOffset + ${i}u];`).join(`
`)}
  return value;
}`}function J(e,t){let r=f(e.type);return`@group(0) @binding(${t}) var<storage, read_write> result: array<${r}>;`}function Q(e){let t=e.stride/e.ValueType.BYTES_PER_ELEMENT,r=e.offset/e.ValueType.BYTES_PER_ELEMENT;return`fn write_result(rowIndex: u32, value: array<${f(e.type)}, ${e.size}>) {
  let rowOffset = ${r}u + rowIndex * ${t}u;
${Array.from({length:e.size},(o,a)=>`  result[rowOffset + ${a}u] = value[${a}];`).join(`
`)}
}`}function ee(e,t,r,n,o){let a="";if(o)for(let s=0;s<r.size;s++)a+=`  result[${s}] = ${o(s)};
`;else if(n){let s=I(r.type),l=f(r.type);for(let i=0;i<r.size;i++){let u=t.map(([c,d])=>i<d.size?f(d.type)===l?`${c}[${i}]`:`${l}(${c}[${i}])`:s);a+=`  result[${i}] = ${e}(${u.join(", ")});
`}}else a+=`result = ${e}(${t.map(([s])=>s).join(", ")});`;return a.trimEnd()}function te(e){return Array.isArray(e)?e.map((t,r)=>[`x${r}`,t]):Object.entries(e)}function re(e,t){let r=e.value;if(!r)throw new Error(`Constant input ${e} is missing CPU values`);return Array.from({length:e.size},(n,o)=>_(t,r[o]??0)).join(", ")}function ne(e,t){for(let r in t)e=e.replaceAll(`{${r}}`,t[r]);return e}var oe=`fn arithmetic_add(x: {TYPE}, y: {TYPE}) -> {TYPE} {
  return x + y;
}

fn arithmetic_subtract(x: {TYPE}, y: {TYPE}) -> {TYPE} {
  return x - y;
}

fn arithmetic_multiply(x: {TYPE}, y: {TYPE}) -> {TYPE} {
  return x * y;
}

fn arithmetic_divide(x: {TYPE}, y: {TYPE}) -> {TYPE} {
  return x / y;
}

fn arithmetic_tan(x: f32) -> f32 {
  return tan_fp32(x);
}
`,ie=({inputs:e,output:t,target:r})=>{let n=t.type,o=f(n),a=I(n),s=e.namedInputs;return m({module:{name:"arithmetic",source:oe,dependencies:[A]},inputs:s,output:t,operationType:n,outputBuffer:r,expression:l=>k(e.expression,{operations:V,inputs:s,laneIndex:l,formatInput:i=>`${i}[${l}]`,formatOutOfBoundsInput:i=>s[i].size===1?`${i}[0]`:a,formatLiteral:i=>{let u=Array.isArray(i)?i[l]??0:i;return`${o}(${F(n,u)})`},formatCall:(i,u)=>`${i}(${u.join(", ")})`})}),{success:!0}};var se=`fn row_dot(x: array<{TYPE}, {X_LEN}>, y: array<{TYPE}, {Y_LEN}>) -> array<f32, 1> {
  var sum = 0.0;
  for (var i = 0u; i < {X_LEN}u; i = i + 1u) {
    sum += f32(x[i]) * f32(y[i]);
  }
  return array<f32, 1>(sum);
}
`,ae=({inputs:e,output:t,target:r})=>(m({module:{name:"row_dot",source:se},inputs:e,output:t,operationType:"float32",outputBuffer:r}),{success:!0});var ue=`fn equalAll(x: array<{TYPE}, {X_LEN}>, y: array<{TYPE}, {Y_LEN}>) -> array<u32, 1> {
  var allEqual = 1u;
  for (var i = 0u; i < {X_LEN}u; i = i + 1u) {
    if (x[i] != y[i]) {
      allEqual = 0u;
      break;
    }
  }
  return array<u32, 1>(allEqual);
}
`,ce=({inputs:e,output:t,target:r})=>(m({module:{name:"equalAll",source:ue},inputs:e,output:t,operationType:e.x.type,outputBuffer:r}),{success:!0});var g=64;function T(e,t,r){let n=f(t.type);return`@group(0) @binding(${r}) var<storage, read> ${e}: array<${n}>;`}function z(e,t,r,n=e){let o=f(r);if(t.isConstant){let u=t.value;if(!u)throw new Error(`Constant input ${t} is missing CPU values`);return`fn read_${n}(_sourceIndex: u32) -> array<${o}, ${t.size}> {
  return array<${o}, ${t.size}>(${Array.from({length:t.size},(c,d)=>_(o,u[d]??0)).join(", ")});
}`}let a=t.stride/t.ValueType.BYTES_PER_ELEMENT,s=t.offset/t.ValueType.BYTES_PER_ELEMENT,i=f(t.type)===o?"":`${o}`;return`fn read_${n}(sourceIndex: u32) -> array<${o}, ${t.size}> {
  var value: array<${o}, ${t.size}>;
  let rowOffset = ${s}u + sourceIndex * ${a}u;
${Array.from({length:t.size},(u,c)=>i?`  value[${c}] = ${i}(${e}[rowOffset + ${c}u]);`:`  value[${c}] = ${e}[rowOffset + ${c}u];`).join(`
`)}
  return value;
}`}function L(e,t){return z("sourceValues",e,t,"source_values")}function S(e,t){let r=f(e.type);return`@group(0) @binding(${t}) var<storage, read_write> result: array<${r}>;`}function b(e){let t=e.stride/e.ValueType.BYTES_PER_ELEMENT,r=e.offset/e.ValueType.BYTES_PER_ELEMENT;return`fn write_result(rowIndex: u32, value: array<${f(e.type)}, ${e.size}>) {
  let rowOffset = ${r}u + rowIndex * ${t}u;
${Array.from({length:e.size},(o,a)=>`  result[rowOffset + ${a}u] = value[${a}];`).join(`
`)}
}`}function Y(e,t){let r=I(e);return`fn zero_result() -> array<${f(e)}, ${t}> {
  var result: array<${f(e)}, ${t}>;
${Array.from({length:t},(n,o)=>`  result[${o}] = ${r};`).join(`
`)}
  return result;
}`}var le=({inputs:e,output:t,target:r})=>{let{sourceValues:n}=e;if(n.length===0){let i=new t.ValueType(t.length*t.size);return r.write(i),{success:!0,value:i}}if(n.isConstant){let i=n.value;if(!i)throw new Error(`Constant input ${n} is missing CPU values`);let u=new t.ValueType(t.length*t.size);for(let c=0;c<t.length;c++){let d=i[c];u[c*2]=d,u[c*2+1]=d}return r.write(u),{success:!0,value:u}}let o=[],a=n,s="raw",l=n.length;try{for(;;){let i=Math.ceil(l/g),u=t.length*i,c=i===1?r:C.createOrReuse(r.device,u*t.stride);if(i>1&&o.push(c),fe({input:a,inputMode:s,inputGroupCount:l,channelCount:t.length,outputType:t.type,outputBuffer:c,outputLength:u,outputStride:t.stride,outputOffset:t.offset}),i===1)break;a=new R({buffer:c,type:t.type,size:2,length:u}),s="partial",l=i}return{success:!0}}finally{for(let i of o)C.recycle(i)}};function fe({input:e,inputMode:t,inputGroupCount:r,channelCount:n,outputType:o,outputBuffer:a,outputLength:s,outputStride:l,outputOffset:i}){let u=f(o),c=w(s,a.device.limits.maxComputeWorkgroupsPerDimension),d=new R({buffer:a,type:o,size:2,length:s,stride:l,offset:i}),x=`
${e.isConstant?"":T("sourceValues",e,0)}
${L(e,o)}
${S(d,e.isConstant?0:1)}
${b(d)}
${de(t,o,n,r)}

var<workgroup> sharedMin: array<${u}, ${g}>;
var<workgroup> sharedMax: array<${u}, ${g}>;

@compute @workgroup_size(${g}) fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>
) {
  let outputRowIndex = ${M(c)};
  if (outputRowIndex >= ${s}u) {
    return;
  }

  let channelIndex = outputRowIndex % ${n}u;
  let outputGroupIndex = outputRowIndex / ${n}u;
  let inputGroupIndex = outputGroupIndex * ${g}u + localId.x;

  let result = extent_pass(channelIndex, inputGroupIndex);
  sharedMin[localId.x] = result[0];
  sharedMax[localId.x] = result[1];
  workgroupBarrier();

  var stride = ${Math.floor(g/2)}u;
  loop {
    if (stride == 0u) {
      break;
    }
    if (localId.x < stride) {
      let compareIndex = localId.x + stride;
      if (sharedMin[compareIndex] < sharedMin[localId.x]) {
        sharedMin[localId.x] = sharedMin[compareIndex];
      }
      if (sharedMax[compareIndex] > sharedMax[localId.x]) {
        sharedMax[localId.x] = sharedMax[compareIndex];
      }
    }
    workgroupBarrier();
    stride = stride / 2u;
  }

  if (localId.x == 0u) {
    write_result(outputRowIndex, array<${u}, 2>(sharedMin[0], sharedMax[0]));
  }
}
`,h=new y(a.device,{source:x,shaderLayout:{bindings:[...e.isConstant?[]:[{name:"sourceValues",type:"storage",group:0,location:0}],{name:"result",type:"storage",group:0,location:e.isConstant?0:1}]}}),v={result:a};e.isConstant||(v.sourceValues=e.buffer),h.setBindings(v);let P=a.device.beginComputePass({});h.dispatch(P,c.x,c.y,c.z),P.end(),a.device.submit(),h.destroy()}function de(e,t,r,n){let o=f(t),[a,s]=pe(t);return e==="raw"?`fn extent_pass(channelIndex: u32, inputGroupIndex: u32) -> array<${o}, 2> {
  var result: array<${o}, 2>;
  result[0] = ${a};
  result[1] = ${s};

  if (inputGroupIndex < ${n}u) {
    let value = read_source_values(inputGroupIndex);
    result[0] = value[channelIndex];
    result[1] = value[channelIndex];
  }

  return result;
}`:`fn extent_pass(channelIndex: u32, inputGroupIndex: u32) -> array<${o}, 2> {
  var result: array<${o}, 2>;
  result[0] = ${a};
  result[1] = ${s};

  if (inputGroupIndex < ${n}u) {
    let rowIndex = inputGroupIndex * ${r}u + channelIndex;
    let value = read_source_values(rowIndex);
    result[0] = value[0];
    result[1] = value[1];
  }

  return result;
}`}function pe(e){switch(e){case"uint32":return["0xffffffffu","0u"];case"sint32":return["2147483647","-2147483648"];case"float32":return["3.402823e38","-3.402823e38"];default:throw new Error(`Unsupported WebGPU extent type for ${e}`)}}function me(){let e=new Uint16Array([255]);return new Uint8Array(e.buffer)[0]>0}var ge=`const LE: bool = ${me()?"true":"false"};
const F32_NAN: u32 = 0xffffffffu;
const F32_INF: u32 = 0x7f800000u;

fn roundShiftRight(value: u32, shift: i32) -> u32 {
  if (shift <= 0) {
    return value << u32(-shift);
  }

  if (shift >= 32) {
    if (shift == 32 && value > 0x80000000u) {
      return 1u;
    }
    return 0u;
  }

  let shiftU32 = u32(shift);
  let truncated = value >> shiftU32;
  let halfShift = 1u << u32(shift - 1);
  let remainder = value & ((1u << shiftU32) - 1u);
  if (remainder > halfShift || (remainder == halfShift && (truncated & 1u) == 1u)) {
    return truncated + 1u;
  }
  return truncated;
}

fn makeFloatImmediate(sign: u32, exponent: i32, mantissa: u32) -> u32 {
  return (sign << 31u) | (u32(exponent + 127) << 23u) | (mantissa & 0x7fffffu);
}

fn makeFloat(sign: u32, exponent: i32, significand: u32) -> u32 {
  if (significand == 0u) {
    return sign << 31u;
  }

  let leadingZeros = i32(countLeadingZeros(significand));
  var normalizedExponent = exponent + 31 - leadingZeros;

  if (normalizedExponent > 127) {
    return (sign << 31u) | F32_INF;
  }

  var mantissa: u32;
  if (normalizedExponent >= -126) {
    mantissa = roundShiftRight(significand, 8 - leadingZeros);
    if (mantissa >= 0x1000000u) {
      mantissa = mantissa >> 1u;
      normalizedExponent += 1;
      if (normalizedExponent > 127) {
        return (sign << 31u) | F32_INF;
      }
    }
    return makeFloatImmediate(sign, normalizedExponent, mantissa);
  }

  let subnormalShift = -149 - exponent;
  mantissa = roundShiftRight(significand, subnormalShift);
  if (mantissa >= 0x800000u) {
    return (sign << 31u) | (1u << 23u);
  }
  return (sign << 31u) | mantissa;
}

fn parseAsDouble(words: vec2<u32>) -> vec2<u32> {
  var d = words;
  if (LE) {
    d = d.yx;
  }

  let sign = (d.x >> 31u) & 1u;
  let exponentBits = (d.x >> 20u) & 0x7ffu;
  let exponent = i32(exponentBits) - 1023;
  let fractionHigh = d.x & 0xfffffu;
  let fractionLow = d.y;

  if (exponentBits == 0x7ffu) {
    if (fractionHigh == 0u && fractionLow == 0u) {
      return vec2<u32>((sign << 31u) | F32_INF, F32_NAN);
    }
    return vec2<u32>(F32_NAN);
  }

  if (exponentBits == 0u) {
    return vec2<u32>(sign << 31u);
  }

  if (exponent > 127) {
    return vec2<u32>((sign << 31u) | F32_INF, ((1u - sign) << 31u) | F32_INF);
  }

  let highSignificand = 0x800000u | (fractionHigh << 3u) | (fractionLow >> 29u);
  let lowSignificand = fractionLow & 0x1fffffffu;

  if (exponent < -126) {
    let highPart = makeFloat(sign, exponent - 23, highSignificand);
    let lowPart = makeFloat(sign, exponent - 52, lowSignificand);
    return vec2<u32>(highPart, lowPart);
  }

  let roundUp = lowSignificand > 0x10000000u ||
    (lowSignificand == 0x10000000u && (highSignificand & 1u) == 1u);

  var roundedSignificand = highSignificand + select(0u, 1u, roundUp);
  var highExponent = exponent;
  if (roundedSignificand == 0x1000000u) {
    roundedSignificand = 0x800000u;
    highExponent += 1;
  }

  if (highExponent > 127) {
    return vec2<u32>((sign << 31u) | F32_INF, ((1u - sign) << 31u) | F32_INF);
  }

  let highPart = makeFloatImmediate(sign, highExponent, roundedSignificand);

  var remainder = i32(lowSignificand);
  var lowSign = sign;
  if (roundUp) {
    remainder -= 0x20000000;
  }
  if (remainder < 0) {
    lowSign = 1u - sign;
    remainder = -remainder;
  }

  let lowPart = makeFloat(lowSign, exponent - 52, u32(remainder));
  return vec2<u32>(highPart, lowPart);
}

fn fround(x: array<u32, {X_LEN}>) -> array<f32, {RESULT_LEN}> {
  var result: array<f32, {RESULT_LEN}>;
  let n = {X_LEN}u / 2u;
  for (var i = 0u; i < n; i = i + 1u) {
    let parts = parseAsDouble(vec2<u32>(x[i * 2u], x[i * 2u + 1u]));
    result[i] = bitcast<f32>(parts.x);
    result[i + n] = bitcast<f32>(parts.y);
  }
  return result;
}
`,xe=({inputs:e,output:t,target:r})=>(m({module:{name:"fround",source:ge},inputs:e,output:t,operationType:"uint32",outputBuffer:r}),{success:!0});var $e=async({inputs:e,output:t,target:r})=>{let{ids:n,sourceValues:o}=e,a=f(n.type),s=[];n.isConstant||s.push({name:"ids",input:n,index:s.length}),o.isConstant||s.push({name:"sourceValues",input:o,index:s.length});let l=w(Math.ceil(t.length/g),r.device.limits.maxComputeWorkgroupsPerDimension),i=`
${s.map(({name:x,input:h,index:v})=>T(x,h,v)).join(`
`)}
${he(n,a)}
${L(o,t.type)}
${S(t,s.length)}
${b(t)}
${Y(t.type,t.size)}
${ye(n.type,t.type,t.size,o.length)}

@compute @workgroup_size(${g}) fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>
) {
  let rowIndex = ${E(l,g)};
  if (rowIndex >= ${t.length}u) {
    return;
  }

  let idsValue = read_ids(rowIndex);
  let result = gather(idsValue);
  write_result(rowIndex, result);
}
`,u=new y(r.device,{source:i,shaderLayout:{bindings:[...s.map(({name:x,index:h})=>({name:x,type:"storage",group:0,location:h})),{name:"result",type:"storage",group:0,location:s.length}]}}),c={};n.isConstant||(c.ids=n.buffer),o.isConstant||(c.sourceValues=o.buffer),c.result=r,u.setBindings(c);let d=r.device.beginComputePass({});return u.dispatch(d,l.x,l.y,l.z),d.end(),r.device.submit(),u.destroy(),{success:!0}};function he(e,t){if(e.isConstant){let o=e.value;if(!o)throw new Error(`Constant input ${e} is missing CPU values`);return`fn read_ids(_rowIndex: u32) -> ${t} {
  return ${_(t,o[0]??0)};
}`}let r=e.stride/e.ValueType.BYTES_PER_ELEMENT,n=e.offset/e.ValueType.BYTES_PER_ELEMENT;return`fn read_ids(rowIndex: u32) -> ${t} {
  let rowOffset = ${n}u + rowIndex * ${r}u;
  return ids[rowOffset];
}`}function ye(e,t,r,n){let o=f(e),a=f(t);return`fn gather(idsValue: ${o}) -> array<${a}, ${r}> {
  let sourceIndex = ${o==="u32"?"i32(idsValue)":o==="i32"?"idsValue":"i32(idsValue)"};
  if (sourceIndex < 0 || sourceIndex >= ${n}) {
    return zero_result();
  }
  return read_source_values(u32(sourceIndex));
}`}var we=async({inputs:e,output:t,target:r})=>{let{segments:n}=e,o=n.isConstant?[]:[{name:"segments",input:n,index:0}],a=w(Math.ceil(t.length/g),r.device.limits.maxComputeWorkgroupsPerDimension),s=`
${o.map(({name:c,input:d,index:x})=>T(c,d,x)).join(`
`)}
${z("segments",n,"uint32")}
${S(t,o.length)}
${b(t)}
${Ee(n.length)}

@compute @workgroup_size(${g}) fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>
) {
  let rowIndex = ${E(a,g)};
  if (rowIndex >= ${t.length}u) {
    return;
  }

  let result = segmented_map(rowIndex);
  write_result(rowIndex, result);
}
`,l=new y(r.device,{source:s,shaderLayout:{bindings:[...o.map(({name:c,index:d})=>({name:c,type:"storage",group:0,location:d})),{name:"result",type:"storage",group:0,location:o.length}]}}),i=Object.fromEntries(o.map(({name:c,input:d})=>[c,d.buffer]));i.result=r,l.setBindings(i);let u=r.device.beginComputePass({});return l.dispatch(u,a.x,a.y,a.z),u.end(),r.device.submit(),l.destroy(),{success:!0}};function Ee(e){return`fn segmented_map(vertexIndex: u32) -> array<u32, 2> {
  var low = 0i;
  var high = ${e}i;
  while (low < high) {
    let mid = low + (high - low) / 2i;
    let midStart = read_segments(u32(mid))[0];
    if (midStart <= vertexIndex) {
      low = mid + 1i;
    } else {
      high = mid;
    }
  }

  let segmentIndex = u32(max(low - 1i, 0i));
  let segmentStart = read_segments(segmentIndex)[0];
  return array<u32, 2>(segmentIndex, vertexIndex - segmentStart);
}`}var _e=({inputs:e,output:t,target:r})=>{let n=e.map((i,u)=>[`x${u}`,i]);Ie(r.device.limits,n);let o=n.map(([i,u])=>`${i}: array<{TYPE}, ${u.size}>`).join(", "),a=0,s=n.map(([i,u])=>{let c=Array.from({length:u.size},(d,x)=>`  out[${a+x}] = ${i}[${x}];`).join(`
`);return a+=u.size,c}).join(`
`),l=`fn interleave(${o}) -> array<{TYPE}, {RESULT_LEN}> {
  var out: array<{TYPE}, {RESULT_LEN}>;
${s}
  return out;
}
`;return m({module:{name:"interleave",source:l},inputs:e,output:t,outputBuffer:r}),{success:!0}};function Ie(e,t){let n=t.filter(([,o])=>!o.isConstant).length+1;if(n>e.maxStorageBuffersPerShaderStage)throw new Error(`interleave() requires ${n} storage buffers, exceeding device limit ${e.maxStorageBuffersPerShaderStage}`);if(n>e.maxBindingsPerBindGroup)throw new Error(`interleave() requires ${n} bindings, exceeding bind group limit ${e.maxBindingsPerBindGroup}`)}var ve=`fn row_length(x: array<{TYPE}, {X_LEN}>) -> array<f32, 1> {
  var sum = 0.0;
  for (var i = 0u; i < {X_LEN}u; i = i + 1u) {
    sum += f32(x[i]) * f32(x[i]);
  }
  return array<f32, 1>(sqrt(sum));
}
`,Pe=({inputs:e,output:t,target:r})=>(m({module:{name:"row_length",source:ve},inputs:e,output:t,operationType:"float32",outputBuffer:r}),{success:!0});var Te=async({inputs:e,output:t,target:r})=>{let n=I(t.type);return m({module:{name:"select",source:`// inline expression select
`},inputs:e,output:t,operationType:t.type,outputBuffer:r,expression:o=>{let a=G("condition",e.condition,o,n),s=G("whenTrue",e.whenTrue,o,n);return`select(${G("whenFalse",e.whenFalse,o,n)}, ${s}, ${a} != ${n})`}}),{success:!0}};function G(e,t,r,n){return r<t.size?`${e}[${r}]`:t.size===1?`${e}[0]`:n}var U=64,Se=({inputs:e,output:t,target:r})=>{let n=w(Math.ceil(t.length/U),r.device.limits.maxComputeWorkgroupsPerDimension),o=`@group(0) @binding(0) var<storage, read_write> result: array<i32>;

@compute @workgroup_size(${U}) fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>
) {
  let rowIndex = ${E(n,U)};
  if (rowIndex >= ${t.length}u) {
    return;
  }

  let rowOffset = ${t.offset/t.ValueType.BYTES_PER_ELEMENT}u + rowIndex * ${t.stride/t.ValueType.BYTES_PER_ELEMENT}u;
  result[rowOffset] = ${e.start} + i32(rowIndex) * ${e.step};
}
`,a=new y(r.device,{source:o,shaderLayout:{bindings:[{name:"result",type:"storage",group:0,location:0}]}});a.setBindings({result:r});let s=r.device.beginComputePass({});return a.dispatch(s,n.x,n.y,n.z),s.end(),r.device.submit(),a.destroy(),{success:!0}};var be=({inputs:e,output:t,target:r})=>{let{columns:n}=e;return m({module:{name:"swizzle",source:"// swizzle expression handled inline"},expression:o=>`x[${n[o]}]`,inputs:{x:e.x},output:t,outputBuffer:r}),{success:!0}};export{ie as a,ae as b,ce as c,le as d,xe as e,$e as f,we as g,_e as h,Pe as i,Te as j,Se as k,be as l};
