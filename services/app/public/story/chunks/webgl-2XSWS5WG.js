import{b as B,d as C,n as Y,o as _,t as E,u as S,w as O,x as U}from"./chunk-AXUDJ75R.js";import{w as v}from"./chunk-D6CH6O54.js";import"./chunk-EMBIDUMY.js";function p(t,e,n=!1){if(n)return e===1?"float":`vec${e}`;switch(t){case"uint8":case"uint16":case"uint32":return e===1?"uint":`uvec${e}`;case"sint8":case"sint16":case"sint32":return e===1?"int":`ivec${e}`;default:return e===1?"float":`vec${e}`}}function L(t,e,n=!1){let r;if(n)switch(t){case"uint8":r="unorm8";break;case"sint8":r="snorm8";break;case"uint16":r="unorm16";break;case"sint16":r="snorm16";break;case"float32":r="float32";break;default:throw new Error(`Unsupported normalized vertex format for ${t}`)}else r=t;return e===1?r:e===3&&!r.startsWith("float32")&&!r.endsWith("32")?`${r}x3-webgl`:`${r}x${e}`}function T(t){switch(t[0]){case"u":return"0u";case"s":return"0";default:return"0."}}function k(t,e){switch(t){case"uint8":case"uint16":case"uint32":return`${Math.trunc(e)}u`;case"sint8":case"sint16":case"sint32":return`${Math.trunc(e)}`;default:return Number.isInteger(e)?`${e}.0`:`${e}`}}function D(t){switch(t){case"uint8":return"r8uint";case"sint8":return"r8sint";case"uint16":return"r16uint";case"sint16":return"r16sint";case"uint32":return"r32uint";case"sint32":return"r32sint";case"float32":return"r32float";default:throw new Error(`Unsupported WebGL gather texture format for ${t}`)}}function V(t){switch(t){case"uint32":return"usampler2D";case"sint32":return"isampler2D";case"float32":return"sampler2D";default:throw new Error(`Unsupported WebGL gather sampler type for ${t}`)}}var W="GPGPU Operation Counts",J="Transform Runs",K=new B;function g({module:t,elementWise:e=!1,expression:n,inputs:r,output:i,operationType:s=i.type,outputBuffer:a}){let u=a.device,o=y("result",i.type,i.size,i.normalized),f=[t,o],d=[],c={},l=p(i.type,1,i.normalized),x=p(s,1,i.normalized),b="",$=null,M={TYPE:x,RESULT_LEN:i.size.toString()},z=Q(r);for(let[m,h]of z)f.push(I(m,h.type,h.size,h.normalized,s)),d.push(R(m,h)),h instanceof S?c[m]=h.buffer:($=$||E.createOrReuse(u,a.byteLength),c[m]=$),b+=`TYPE ${m}[${h.size}]; get_${m}(${m});
`,M[`${m.toUpperCase()}_LEN`]=h.size.toString();let w="";if(n)for(let m=0;m<i.size;m++)w+=`result[${m}]=${n(m)};
`;else if(e)for(let m=0;m<i.size;m++){let h=T(x),j=z.map(([H,Z])=>m<Z.size?`${H}[${m}]`:h);w+=`result[${m}]=${t.name}(${j.join(", ")});
`}else w=`${t.name}(${z.map(([m])=>m).join(", ")}, result);`;let X=`#version 300 es

void main() {
${b}
${l} result[${i.size}];
${w}
set_result(result);
}
  `,q=new _(u,{vs:X,shaderAssembler:K,defines:M,modules:f,bufferLayout:d,vertexCount:1,instanceCount:i.length,attributes:c,feedbackBufferMode:"interleaved",outputs:o.varyings});u.statsManager.getStats(W).get(J).incrementCount(),q.run({inputBuffers:c,outputBuffers:{[o.varyings[0]]:i.offset===0?a:{buffer:a,byteOffset:i.offset,byteLength:i.byteLength}}}),$&&E.recycle($)}function Q(t){return Array.isArray(t)?t.map((e,n)=>[`x${n}`,e]):Object.entries(t)}function I(t,e,n,r=!1,i=e){let s="",a="";for(let o=0;o<n;o+=4){let f=Math.min(n-o,4),d=p(e,f,r);s+=`in ${d} a${t}_${o};
`;for(let c=0;c<f;c++){let l=`a${t}_${o}`;f>1&&(l=`${l}[${c}]`),(r||e!==i)&&(l=`TYPE(${l})`),a+=`v[${o+c}]=${l};
`}}let u=`
${s}
void get_${t}(out TYPE v[${n}]) {
  ${a}
}
`;return{name:t,vs:u}}function R(t,e){let n={name:t,stepMode:e.isConstant?"vertex":"instance",byteStride:e.stride,attributes:[]};for(let r=0;r<e.size;r+=4){let i=Math.min(e.size-r,4);n.attributes.push({attribute:`a${t}_${r}`,format:L(e.type,i,e.normalized),byteOffset:e.offset+e.ValueType.BYTES_PER_ELEMENT*r})}return n}function y(t,e,n,r=!1){let i=[],s=p(e,1,r),a="",u="";for(let o=0;o<n;o+=4){let f=Math.min(n-o,4),d=p(e,f,r);i.push(`${t}_${o}`),a+=`flat out ${d} ${t}_${o};
`;let c=Array.from({length:f},(l,x)=>o+x);u+=`${t}_${o} = ${d}(${c.map(l=>`v[${l}]`).join(",")});
`}return{name:t,varyings:i,vs:`
${a}
void set_${t}(in ${s} v[${n}]) {
  ${u}
}
`}}var ee=`TYPE arithmetic_add(TYPE x, TYPE y) {
  return x + y;
}

TYPE arithmetic_subtract(TYPE x, TYPE y) {
  return x - y;
}

TYPE arithmetic_multiply(TYPE x, TYPE y) {
  return x * y;
}

TYPE arithmetic_divide(TYPE x, TYPE y) {
  return x / y;
}

float arithmetic_tan(float x) {
  return tan_fp32(x);
}
`,A=({inputs:t,output:e,target:n})=>{let r=e.type,i=p(r,1,e.normalized),s=T(i),a=t.namedInputs;return g({module:{name:"arithmetic",dependencies:[C],vs:ee},inputs:a,output:e,operationType:r,outputBuffer:n,expression:u=>U(t.expression,{operations:O,inputs:a,laneIndex:u,formatInput:o=>`${o}[${u}]`,formatOutOfBoundsInput:o=>a[o].size===1?`${o}[0]`:s,formatLiteral:o=>{let f=Array.isArray(o)?o[u]??0:o;return`${i}(${k(r,f)})`},formatCall:(o,f)=>`${o}(${f.join(", ")})`})}),{success:!0}};var te="GPGPU Operation Counts",re="Transform Runs",ne=({inputs:t,output:e,target:n})=>{let{sourceValues:r}=t,i=n.device;if(r.length===0){let c=new e.ValueType(e.length*e.size);return n.write(c),{success:!0,value:c}}if(r.isConstant){let c=r.value,l=new e.ValueType(e.length*e.size);for(let x=0;x<e.length;x++){let b=c[x];l[x*2]=b,l[x*2+1]=b}return n.write(l),{success:!0,value:l}}let s=i.createTexture({width:1,height:e.length,format:"rg32float",usage:v.RENDER|v.COPY_SRC|v.COPY_DST}),a=i.createFramebuffer({colorAttachments:[s]}),u=`#version 300 es

flat out float extent_value;

void main() {
  float sourceValues[SOURCE_VALUES_LEN];
  get_sourceValues(sourceValues);
  extent_value = sourceValues[gl_VertexID];

  float y = (float(gl_VertexID) + 0.5) / float(CHANNEL_COUNT) * 2.0 - 1.0;
  gl_Position = vec4(0.0, y, 0.0, 1.0);
  gl_PointSize = 1.0;
}
  `,o=`#version 300 es

precision highp float;

flat in float extent_value;
out vec2 fragColor;

void main() {
  fragColor = vec2(-extent_value, extent_value);
}
  `,f=new Y(i,{vs:u,fs:o,topology:"point-list",parameters:{depthCompare:"always",blend:!0,blendColorSrcFactor:"one",blendColorDstFactor:"one",blendColorOperation:"max",blendAlphaSrcFactor:"one",blendAlphaDstFactor:"one",blendAlphaOperation:"max"},modules:[I("sourceValues",r.type,r.size,r.normalized)],defines:{TYPE:"float",SOURCE_VALUES_LEN:r.size.toString(),CHANNEL_COUNT:e.length.toString()},attributes:{sourceValues:r.buffer},bufferLayout:[R("sourceValues",r)],instanceCount:r.length,vertexCount:e.length,disableWarnings:!0}),d=E.createOrReuse(i,e.byteLength);try{let c=i.beginRenderPass({framebuffer:a,parameters:{viewport:[0,0,1,e.length]},clearColor:[-G,-G,0,0],clearDepth:!1,clearStencil:!1});i.statsManager.getStats(te).get(re).incrementCount(),f.draw(c),c.end();let l=i.createCommandEncoder();return l.copyTextureToBuffer({sourceTexture:s,width:1,height:e.length,destinationBuffer:d,byteOffset:0,bytesPerRow:8}),i.submit(l.finish()),A({device:i,inputs:{expression:{kind:"call",op:"multiply",args:[{kind:"input",name:"x"},{kind:"literal",value:[-1,1]}]},namedInputs:{x:new S({buffer:d,size:2,type:"float32",length:e.length})}},output:e,target:n})}finally{f.destroy(),E.recycle(d),a.destroy(),s.destroy()}},G=3e38;var ie=({inputs:t,output:e,target:n})=>{let r=t.map((o,f)=>[`x${f}`,o]);oe(n.device.limits.maxVertexAttributes,r),se(n.device.limits.maxInterStageShaderVariables,e);let i=r.map(([o,f])=>`in TYPE ${o}[${f.size}]`).join(", "),s=0,a=r.map(([o,f])=>{let d=Array.from({length:f.size},(c,l)=>`  result[${s+l}] = ${o}[${l}];`).join(`
`);return s+=f.size,d}).join(`
`),u=`void interleave(${i}, out TYPE result[RESULT_LEN]) {
${a}
}
`;return g({module:{name:"interleave",vs:u},inputs:t,output:e,outputBuffer:n}),{success:!0}};function oe(t,e){let n=e.reduce((r,[,i])=>r+Math.ceil(i.size/4),0);if(n>t)throw new Error(`interleave() requires ${n} vertex attributes, exceeding device limit ${t}`)}function se(t,e){if(e.size>t)throw new Error(`interleave() output size ${e.size} exceeds device inter-stage component limit ${t}`)}function ae(){let t=new Uint16Array([255]);return new Uint8Array(t.buffer)[0]>0}var ue=`#define LE ${ae()?1:0}
const uint F32_NAN = 0xffffffffu;
const uint F32_INF = 0x7f800000u;

// Find first set bit using binary search
// https://en.wikipedia.org/wiki/Find_first_set#CLZ
int countLeadingZeros(uint a) {
  if (a == 0u) return 32;
  int n = 0;
  if ((a & 0xffff0000u) == 0u) { n += 16; a = a << 16; }
  if ((a & 0xff000000u) == 0u) { n += 8;  a = a << 8;  }
  if ((a & 0xf0000000u) == 0u) { n += 4;  a = a << 4;  }
  if ((a & 0xc0000000u) == 0u) { n += 2;  a = a << 2;  }
  if ((a & 0x80000000u) == 0u) return n + 1;
  return n;
}

uint roundShiftRight(uint value, int shift) {
  if (shift <= 0) {
    return value << (-shift);
  }

  if (shift >= 32) {
    if (shift == 32 && value > 0x80000000u) {
      return 1u;
    }
    return 0u;
  }

  uint truncated = value >> shift;
  uint halfShift = 1u << (shift - 1);
  uint remainder = value & ((1u << shift) - 1u);
  if (remainder > halfShift || (remainder == halfShift && (truncated & 1u) == 1u)) {
    return truncated + 1u;
  }
  return truncated;
}

uint makeFloat_(uint sign, int exponent, uint mantissa) {
  return (sign << 31) | (uint(exponent + 127) << 23) | (mantissa & 0x7fffffu);
}

/**
 * Assemble a float32 in bit representation according to IEEE 754
 * https://en.wikipedia.org/wiki/Single-precision_floating-point_format
 */
uint makeFloat(uint sign, int exponent, uint significand) {
  if (significand == 0u) {
    return sign << 31;
  }

  // Remove any extra leading zeros for better precision
  int lead_zeros = countLeadingZeros(significand);
  // Significand is encoded as 1.fraction
  int normalizedExponent = exponent + 31 - lead_zeros;

  if (normalizedExponent > 127) {
    return (sign << 31) | F32_INF;
  }

  uint mantissa;
  if (normalizedExponent >= -126) {
    mantissa = roundShiftRight(significand, 8 - lead_zeros);
    if (mantissa >= 0x1000000u) {
      mantissa >>= 1;
      normalizedExponent++;
      if (normalizedExponent > 127) {
        return (sign << 31) | F32_INF;
      }
    }
    return makeFloat_(sign, normalizedExponent, mantissa);
  }

  int subnormalShift = -149 - exponent;
  mantissa = roundShiftRight(significand, subnormalShift);
  if (mantissa >= 0x800000u) {
    return (sign << 31) | (1u << 23);
  }
  return (sign << 31) | mantissa;
}

/**
 * Parse 8-byte memory as a float64 number according to IEEE 754
 * https://en.wikipedia.org/wiki/Double-precision_floating-point_format
 * Returns 8-byte memory as 2 float32 numbers, consisting of
 * high part: fround(d)
 * low part: d - fround(d)
 */
uvec2 parseAsDouble(uvec2 d) {
  #if LE
  d = d.yx; // to big endian
  #endif

  uint sign = (d[0] >> 31) & 1u; // first bit
  uint exponentBits = (d[0] >> 20) & 0x7ffu;
  int exponent = int(exponentBits) - 1023; // next 11 bits
  uint fractionHigh = d[0] & 0xfffffu;
  uint fractionLow = d[1];

  if (exponentBits == 0x7ffu) {
    if (fractionHigh == 0u && fractionLow == 0u) {
      return uvec2((sign << 31) | F32_INF, F32_NAN);
    }
    return uvec2(F32_NAN);
  }
  
  if (exponentBits == 0u) {
    // All float64 subnormals are too small to survive a float32 split.
    return uvec2(sign << 31);
  }

  if (exponent > 127) {
    return uvec2((sign << 31) | F32_INF, ((1u - sign) << 31) | F32_INF);
  }

  uint hi_part;
  uint low_part;

  // float64 significand has 52 bits
  // float32 significand has 23 bits
  // The significand of the high part is the significand of the double, trimmed
  uint f_hi = 0x800000u | (fractionHigh << 3) | (fractionLow >> 29);
  uint f_low = fractionLow & 0x1fffffffu;

  if (exponent < -126) {
    // For tiny normals, the top 24 significand bits still contribute to the float32
    // high part, but they land in the float32 subnormal range.
    hi_part = makeFloat(sign, exponent - 23, f_hi);

    // The residual keeps the remaining 29 significand bits at the original double scale.
    low_part = makeFloat(sign, exponent - 52, f_low);
    return uvec2(hi_part, low_part);
  }

  bool roundUp = f_low > 0x10000000u || (f_low == 0x10000000u && (f_hi & 1u) == 1u);

  uint f_rounded = f_hi + (roundUp ? 1u : 0u);
  int exponent_hi = exponent;
  if (f_rounded == 0x1000000u) {
    f_rounded = 0x800000u;
    exponent_hi++;
  }

  if (exponent_hi > 127) {
    // Overflows float32 limit
    hi_part = (sign << 31) | F32_INF;
    low_part = ((1u - sign) << 31) | F32_INF;
    return uvec2(hi_part, low_part);
  }
  
  hi_part = makeFloat_(sign, exponent_hi, f_rounded);

  int remainder = int(f_low);
  uint sign_low = sign;
  if (roundUp) {
    remainder -= 0x20000000;
  }
  if (remainder < 0) {
    sign_low = 1u - sign;
    remainder = -remainder;
  }
  low_part = makeFloat(sign_low, exponent - 52, uint(remainder));

  return uvec2(hi_part, low_part);
}

void fround(in uint x[X_LEN], out float result[X_LEN]) {
  int n = X_LEN / 2;
  for (int i = 0; i < n; i++) {
    uvec2 f = parseAsDouble(uvec2(x[i * 2], x[i * 2 + 1]));
    result[i] = uintBitsToFloat(f.x);
    result[i + n] = uintBitsToFloat(f.y);
  }
}
`,fe=({inputs:t,output:e,target:n})=>(g({module:{name:"fround",vs:ue},inputs:t,output:e,operationType:"uint32",outputBuffer:n}),{success:!0});function P(t,e,n){let r=V(n),i=p(e,1),s=Array.from({length:t.size},(a,u)=>`  v[${u}] = ${i}(texelFetch(source_values_texture, ivec2(${u}, rowIndex), 0).r);`).join(`
`);return{name:"source_values_texture",vs:`
uniform highp ${r} source_values_texture;
void read_source_values(int rowIndex, out TYPE v[${t.size}]) {
${s}
}
`}}function N(t,e,n){let r=n.createTexture({width:Math.max(t.size,1),height:t.length,format:D(e),usage:v.SAMPLE|v.COPY_DST});if(t.length===0)return r;let i=n.createCommandEncoder();return i.copyBufferToTexture({sourceBuffer:t.buffer,destinationTexture:r,byteOffset:t.offset,bytesPerRow:t.stride,rowsPerImage:t.length,size:[t.size,t.length,1]}),n.submit(i.finish()),r}var le=async({inputs:t,output:e,target:n})=>{let{ids:r,sourceValues:i}=t,s=n.device,a=y("result",e.type,e.size),u=p(r.type,1),o=p(e.type,1),f=e.type,d=N(i,f,s),c=`#version 300 es

void main() {
  INDEX_TYPE ids[1];
  get_ids(ids);
  TYPE result[${e.size}];
  gather(ids, result);
  set_result(result);
}
  `,l=new _(s,{vs:c,defines:{INDEX_TYPE:u,TYPE:o,RESULT_LEN:e.size.toString(),SOURCE_VALUES_ROWS:i.length.toString()},modules:[ce(r,u),P(i,e.type,f),de(e.type),a],bindings:{source_values_texture:d},bufferLayout:[me(r)],vertexCount:1,instanceCount:e.length,feedbackBufferMode:"interleaved",outputs:a.varyings});try{return l.run({inputBuffers:{ids:r.buffer},outputBuffers:{[a.varyings[0]]:n}}),{success:!0}}finally{l.destroy(),d.destroy()}};function ce(t,e){let n=p(t.type,1),r="aids_0";return t.type!==pe(e)&&(r=`${e}(${r})`),{name:"ids",vs:`
in ${n} aids_0;
void get_ids(out INDEX_TYPE v[1]) {
  v[0] = ${r};
}
`}}function me(t){return{name:"ids",stepMode:t.isConstant?"vertex":"instance",byteStride:t.stride,attributes:[{attribute:"aids_0",format:L(t.type,1,t.normalized),byteOffset:t.offset}]}}function de(t){return{name:"gather",vs:`
void zero_result(out TYPE result[RESULT_LEN]) {
  for (int i = 0; i < RESULT_LEN; i++) {
    result[i] = ${T(t)};
  }
}

void gather(in INDEX_TYPE ids[1], out TYPE result[RESULT_LEN]) {
  int sourceIndex = int(ids[0]);
  if (sourceIndex < 0 || sourceIndex >= SOURCE_VALUES_ROWS) {
    zero_result(result);
    return;
  }
  read_source_values(sourceIndex, result);
}
`}}function pe(t){switch(t){case"uint":return"uint32";case"int":return"sint32";default:return"float32"}}var ge=`void row_dot(in TYPE x[X_LEN], in TYPE y[Y_LEN], out float result[1]) {
  float sum = 0.0;
  for (int i = 0; i < X_LEN; i++) {
    sum += float(x[i]) * float(y[i]);
  }
  result[0] = sum;
}
`,xe=({inputs:t,output:e,target:n})=>(g({module:{name:"row_dot",vs:ge},inputs:t,output:e,operationType:"float32",outputBuffer:n}),{success:!0});var he=`void equalAll(in TYPE x[X_LEN], in TYPE y[Y_LEN], out uint result[1]) {
  uint allEqual = uint(1);
  for (int i = 0; i < X_LEN; i++) {
    if (x[i] != y[i]) {
      allEqual = uint(0);
      break;
    }
  }
  result[0] = allEqual;
}
`,_e=({inputs:t,output:e,target:n})=>(g({module:{name:"equalAll",vs:he},inputs:t,output:e,operationType:e.type==="uint32"?t.x.type:e.type,outputBuffer:n}),{success:!0});var Te=`void row_length(in TYPE x[X_LEN], out float result[1]) {
  float sum = 0.0;
  for (int i = 0; i < X_LEN; i++) {
    sum += float(x[i]) * float(x[i]);
  }
  result[0] = sqrt(sum);
}
`,ve=({inputs:t,output:e,target:n})=>(g({module:{name:"row_length",vs:Te},inputs:t,output:e,operationType:"float32",outputBuffer:n}),{success:!0});var ye=async({inputs:t,output:e,target:n})=>{let{segments:r}=t,i=n.device,s=y("result",e.type,e.size),a=r.type,u=N(r,a,i),o=new _(i,{vs:`#version 300 es

void main() {
  TYPE result[RESULT_LEN];
  segmentedMap(result);
  set_result(result);
}
`,defines:{TYPE:"uint",RESULT_LEN:e.size.toString(),SEGMENTS_LENGTH:r.length.toString()},modules:[P(r,e.type,a),Ee(),s],bindings:{source_values_texture:u},vertexCount:1,instanceCount:e.length,feedbackBufferMode:"interleaved",outputs:s.varyings});try{return o.run({outputBuffers:{[s.varyings[0]]:n}}),{success:!0}}finally{o.destroy(),u.destroy()}};function Ee(){return{name:"segmentedMap",vs:`
uint read_segment_start(int segmentIndex) {
  TYPE value[1];
  read_source_values(segmentIndex, value);
  return uint(value[0]);
}

void segmentedMap(out TYPE result[RESULT_LEN]) {
  uint vertexIndex = uint(gl_InstanceID);
  int low = 0;
  int high = SEGMENTS_LENGTH;

  while (low < high) {
    int mid = low + (high - low) / 2;
    uint midStart = read_segment_start(mid);
    if (midStart <= vertexIndex) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  uint segmentIndex = uint(max(low - 1, 0));
  uint segmentStart = read_segment_start(int(segmentIndex));
  result[0] = segmentIndex;
  result[1] = vertexIndex - segmentStart;
}
`}}var be=async({inputs:t,output:e,target:n})=>{let r=p(e.type,1,e.normalized),i=T(r);return g({module:{name:"select",vs:""},inputs:t,output:e,operationType:e.type,outputBuffer:n,expression:s=>{let a=F("condition",t.condition,s,i),u=F("whenTrue",t.whenTrue,s,i),o=F("whenFalse",t.whenFalse,s,i);return`(${a} != ${i} ? ${u} : ${o})`}}),{success:!0}};function F(t,e,n,r){return n<e.size?`${t}[${n}]`:e.size===1?`${t}[0]`:r}var $e=({inputs:t,output:e,target:n})=>{let r=y("result",e.type,e.size),i=new _(n.device,{vs:`#version 300 es

void main() {
  int result[1];
  result[0] = START + gl_InstanceID * STEP;
  set_result(result);
}
`,defines:{START:t.start.toString(),STEP:t.step.toString()},modules:[r],vertexCount:1,instanceCount:e.length,feedbackBufferMode:"interleaved",outputs:r.varyings});try{return i.run({outputBuffers:{[r.varyings[0]]:n}}),{success:!0}}finally{i.destroy()}};var we=({inputs:t,output:e,target:n})=>{let{columns:r}=t;return g({module:{name:"swizzle",vs:"// swizzle expression handled inline"},expression:i=>`x[${r[i]}]`,inputs:{x:t.x},output:e,outputBuffer:n}),{success:!0}};export{A as arithmetic,xe as dot,_e as equalAll,ne as extent,fe as fround,le as gather,ie as interleave,ve as length,ye as segmentedMap,be as select,$e as sequence,we as swizzle};
