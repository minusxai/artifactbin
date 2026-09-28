import{B as oi,D as si,E as Ce,F as Ne,G as ai,H as ui,R as W,S as fi,U as Re,V as me,W as li,X as lt,Y as ci,c as Qt,d as _,e as ei,g as A,h as ti,i as pe,k as Pe,l as I,r as ge,w as ii,x as ni,y as ri}from"./chunk-D6CH6O54.js";var Hn=`#ifdef LUMA_FP32_TAN_PRECISION_WORKAROUND

// All these functions are for substituting tan() function from Intel GPU only
const float TWO_PI = 6.2831854820251465;
const float PI_2 = 1.5707963705062866;
const float PI_16 = 0.1963495463132858;

const float SIN_TABLE_0 = 0.19509032368659973;
const float SIN_TABLE_1 = 0.3826834261417389;
const float SIN_TABLE_2 = 0.5555702447891235;
const float SIN_TABLE_3 = 0.7071067690849304;

const float COS_TABLE_0 = 0.9807852506637573;
const float COS_TABLE_1 = 0.9238795042037964;
const float COS_TABLE_2 = 0.8314695954322815;
const float COS_TABLE_3 = 0.7071067690849304;

const float INVERSE_FACTORIAL_3 = 1.666666716337204e-01; // 1/3!
const float INVERSE_FACTORIAL_5 = 8.333333767950535e-03; // 1/5!
const float INVERSE_FACTORIAL_7 = 1.9841270113829523e-04; // 1/7!
const float INVERSE_FACTORIAL_9 = 2.75573188446287533e-06; // 1/9!

float sin_taylor_fp32(float a) {
  float r, s, t, x;

  if (a == 0.0) {
    return 0.0;
  }

  x = -a * a;
  s = a;
  r = a;

  r = r * x;
  t = r * INVERSE_FACTORIAL_3;
  s = s + t;

  r = r * x;
  t = r * INVERSE_FACTORIAL_5;
  s = s + t;

  r = r * x;
  t = r * INVERSE_FACTORIAL_7;
  s = s + t;

  r = r * x;
  t = r * INVERSE_FACTORIAL_9;
  s = s + t;

  return s;
}

void sincos_taylor_fp32(float a, out float sin_t, out float cos_t) {
  if (a == 0.0) {
    sin_t = 0.0;
    cos_t = 1.0;
  }
  sin_t = sin_taylor_fp32(a);
  cos_t = sqrt(1.0 - sin_t * sin_t);
}

float tan_taylor_fp32(float a) {
    float sin_a;
    float cos_a;

    if (a == 0.0) {
        return 0.0;
    }

    // 2pi range reduction
    float z = floor(a / TWO_PI);
    float r = a - TWO_PI * z;

    float t;
    float q = floor(r / PI_2 + 0.5);
    int j = int(q);

    if (j < -2 || j > 2) {
        return 1.0 / 0.0;
    }

    t = r - PI_2 * q;

    q = floor(t / PI_16 + 0.5);
    int k = int(q);
    int abs_k = int(abs(float(k)));

    if (abs_k > 4) {
        return 1.0 / 0.0;
    } else {
        t = t - PI_16 * q;
    }

    float u = 0.0;
    float v = 0.0;

    float sin_t, cos_t;
    float s, c;
    sincos_taylor_fp32(t, sin_t, cos_t);

    if (k == 0) {
        s = sin_t;
        c = cos_t;
    } else {
        if (abs(float(abs_k) - 1.0) < 0.5) {
            u = COS_TABLE_0;
            v = SIN_TABLE_0;
        } else if (abs(float(abs_k) - 2.0) < 0.5) {
            u = COS_TABLE_1;
            v = SIN_TABLE_1;
        } else if (abs(float(abs_k) - 3.0) < 0.5) {
            u = COS_TABLE_2;
            v = SIN_TABLE_2;
        } else if (abs(float(abs_k) - 4.0) < 0.5) {
            u = COS_TABLE_3;
            v = SIN_TABLE_3;
        }
        if (k > 0) {
            s = u * sin_t + v * cos_t;
            c = u * cos_t - v * sin_t;
        } else {
            s = u * sin_t - v * cos_t;
            c = u * cos_t + v * sin_t;
        }
    }

    if (j == 0) {
        sin_a = s;
        cos_a = c;
    } else if (j == 1) {
        sin_a = c;
        cos_a = -s;
    } else if (j == -1) {
        sin_a = -c;
        cos_a = s;
    } else {
        sin_a = -s;
        cos_a = -c;
    }
    return sin_a / cos_a;
}
#endif

float tan_fp32(float a) {
#ifdef LUMA_FP32_TAN_PRECISION_WORKAROUND
  return tan_taylor_fp32(a);
#else
  return tan(a);
#endif
}
`,qn=`#ifdef LUMA_FP32_TAN_PRECISION_WORKAROUND
const FP32_TWO_PI: f32 = 6.2831854820251465;
const FP32_PI_2: f32 = 1.5707963705062866;
const FP32_PI_16: f32 = 0.1963495463132858;

const FP32_SIN_TABLE_0: f32 = 0.19509032368659973;
const FP32_SIN_TABLE_1: f32 = 0.3826834261417389;
const FP32_SIN_TABLE_2: f32 = 0.5555702447891235;
const FP32_SIN_TABLE_3: f32 = 0.7071067690849304;

const FP32_COS_TABLE_0: f32 = 0.9807852506637573;
const FP32_COS_TABLE_1: f32 = 0.9238795042037964;
const FP32_COS_TABLE_2: f32 = 0.8314695954322815;
const FP32_COS_TABLE_3: f32 = 0.7071067690849304;

const FP32_INVERSE_FACTORIAL_3: f32 = 1.666666716337204e-01;
const FP32_INVERSE_FACTORIAL_5: f32 = 8.333333767950535e-03;
const FP32_INVERSE_FACTORIAL_7: f32 = 1.9841270113829523e-04;
const FP32_INVERSE_FACTORIAL_9: f32 = 2.75573188446287533e-06;
const FP32_OVERFLOW: f32 = 3.402823466e+38;

fn sin_taylor_fp32(a: f32) -> f32 {
  if (a == 0.0) {
    return 0.0;
  }

  let x = -a * a;
  var sum = a;
  var term = a;

  term = term * x;
  sum = sum + term * FP32_INVERSE_FACTORIAL_3;
  term = term * x;
  sum = sum + term * FP32_INVERSE_FACTORIAL_5;
  term = term * x;
  sum = sum + term * FP32_INVERSE_FACTORIAL_7;
  term = term * x;
  sum = sum + term * FP32_INVERSE_FACTORIAL_9;

  return sum;
}

fn tan_taylor_fp32(a: f32) -> f32 {
  if (a == 0.0) {
    return 0.0;
  }

  let z = floor(a / FP32_TWO_PI);
  let reduced = a - FP32_TWO_PI * z;

  var quadrantValue = floor(reduced / FP32_PI_2 + 0.5);
  let quadrant = i32(quadrantValue);
  if (quadrant < -2 || quadrant > 2) {
    return FP32_OVERFLOW;
  }

  var angle = reduced - FP32_PI_2 * quadrantValue;
  quadrantValue = floor(angle / FP32_PI_16 + 0.5);
  let tableIndex = i32(quadrantValue);
  let absoluteTableIndex = abs(tableIndex);
  if (absoluteTableIndex > 4) {
    return FP32_OVERFLOW;
  }

  angle = angle - FP32_PI_16 * quadrantValue;
  let sinAngle = sin_taylor_fp32(angle);
  let cosAngle = sqrt(1.0 - sinAngle * sinAngle);

  var tableCos = 0.0;
  var tableSin = 0.0;
  if (absoluteTableIndex == 1) {
    tableCos = FP32_COS_TABLE_0;
    tableSin = FP32_SIN_TABLE_0;
  } else if (absoluteTableIndex == 2) {
    tableCos = FP32_COS_TABLE_1;
    tableSin = FP32_SIN_TABLE_1;
  } else if (absoluteTableIndex == 3) {
    tableCos = FP32_COS_TABLE_2;
    tableSin = FP32_SIN_TABLE_2;
  } else if (absoluteTableIndex == 4) {
    tableCos = FP32_COS_TABLE_3;
    tableSin = FP32_SIN_TABLE_3;
  }

  var sinReduced = sinAngle;
  var cosReduced = cosAngle;
  if (tableIndex > 0) {
    sinReduced = tableCos * sinAngle + tableSin * cosAngle;
    cosReduced = tableCos * cosAngle - tableSin * sinAngle;
  } else if (tableIndex < 0) {
    sinReduced = tableCos * sinAngle - tableSin * cosAngle;
    cosReduced = tableCos * cosAngle + tableSin * sinAngle;
  }

  var sinValue = 0.0;
  var cosValue = 0.0;
  if (quadrant == 0) {
    sinValue = sinReduced;
    cosValue = cosReduced;
  } else if (quadrant == 1) {
    sinValue = cosReduced;
    cosValue = -sinReduced;
  } else if (quadrant == -1) {
    sinValue = -cosReduced;
    cosValue = sinReduced;
  } else {
    sinValue = -sinReduced;
    cosValue = -cosReduced;
  }

  return sinValue / cosValue;
}

fn tan_fp32(a: f32) -> f32 {
  return tan_taylor_fp32(a);
}
#else
fn tan_fp32(a: f32) -> f32 {
  return tan(a);
}
#endif
`,Zn={name:"fp32",source:qn,vs:Hn};var C="(?:var<\\s*(uniform|storage(?:\\s*,\\s*[A-Za-z_][A-Za-z0-9_]*)?)\\s*>|var)\\s+([A-Za-z_][A-Za-z0-9_]*)";var ne=[new RegExp(`@binding\\(\\s*(auto|\\d+)\\s*\\)\\s*@group\\(\\s*(\\d+)\\s*\\)\\s*${C}`,"g"),new RegExp(`@group\\(\\s*(\\d+)\\s*\\)\\s*@binding\\(\\s*(auto|\\d+)\\s*\\)\\s*${C}`,"g")],De=[new RegExp(`@binding\\(\\s*(auto|\\d+)\\s*\\)\\s*@group\\(\\s*(\\d+)\\s*\\)\\s*${C}`,"g"),new RegExp(`@group\\(\\s*(\\d+)\\s*\\)\\s*@binding\\(\\s*(auto|\\d+)\\s*\\)\\s*${C}`,"g")],di=[new RegExp(`@binding\\(\\s*(\\d+)\\s*\\)\\s*@group\\(\\s*(\\d+)\\s*\\)\\s*${C}`,"g"),new RegExp(`@group\\(\\s*(\\d+)\\s*\\)\\s*@binding\\(\\s*(\\d+)\\s*\\)\\s*${C}`,"g")],Xn=[new RegExp(`@binding\\(\\s*(auto)\\s*\\)\\s*@group\\(\\s*(\\d+)\\s*\\)\\s*${C}`,"g"),new RegExp(`@group\\(\\s*(\\d+)\\s*\\)\\s*@binding\\(\\s*(auto)\\s*\\)\\s*${C}`,"g"),new RegExp(`@binding\\(\\s*(auto)\\s*\\)\\s*@group\\(\\s*(\\d+)\\s*\\)(?:[\\s\\n\\r]*@[A-Za-z_][^\\n\\r]*)*[\\s\\n\\r]*${C}`,"g"),new RegExp(`@group\\(\\s*(\\d+)\\s*\\)\\s*@binding\\(\\s*(auto)\\s*\\)(?:[\\s\\n\\r]*@[A-Za-z_][^\\n\\r]*)*[\\s\\n\\r]*${C}`,"g")];function re(t){let e=t.split(""),i=0,n=0,r=!1,o=!1,s=!1;for(;i<t.length;){let a=t[i],u=t[i+1];if(o){s?s=!1:a==="\\"?s=!0:a==='"'&&(o=!1),i++;continue}if(r){a===`
`||a==="\r"?r=!1:e[i]=" ",i++;continue}if(n>0){if(a==="/"&&u==="*"){e[i]=" ",e[i+1]=" ",n++,i+=2;continue}if(a==="*"&&u==="/"){e[i]=" ",e[i+1]=" ",n--,i+=2;continue}a!==`
`&&a!=="\r"&&(e[i]=" "),i++;continue}if(a==='"'){o=!0,i++;continue}if(a==="/"&&u==="/"){e[i]=" ",e[i+1]=" ",r=!0,i+=2;continue}if(a==="/"&&u==="*"){e[i]=" ",e[i+1]=" ",n=1,i+=2;continue}i++}return e.join("")}function Z(t,e){let i=re(t),n=[];for(let r of e){r.lastIndex=0;let o;for(o=r.exec(i);o;){let s=r===e[0],a=o.index,u=o[0].length;n.push({match:t.slice(a,a+u),index:a,length:u,bindingToken:o[s?1:2],groupToken:o[s?2:1],accessDeclaration:o[3]?.trim(),name:o[4]}),o=r.exec(i)}}return n.sort((r,o)=>r.index-o.index)}function ct(t,e,i){let n=Z(t,e);if(!n.length)return t;let r="",o=0;for(let s of n)r+=t.slice(o,s.index),r+=i(s),o=s.index+s.length;return r+=t.slice(o),r}function dt(t){return/@binding\(\s*auto\s*\)/.test(re(t))}function hi(t,e){return Z(t,e===ne||e===De?Xn:e).find(n=>n.bindingToken==="auto")}function Me(t,e={}){let i=pi(t),n=Kn(i);if(!n)return null;let r=Yn(i,n);if(!r)return null;let o=Qn(i,n,r);if(!o)return null;if(e.scanVertexAttributes===!1)return{attributes:[],bindings:o};let s=Jn(i,n);if(!s)return null;let a=rr(i,n,r,s,e.vertexEntryPoint);return a?{attributes:a,bindings:o}:null}function pi(t){let e=re(t),i=/[A-Za-z_][A-Za-z0-9_]*|(?:0[xX][0-9A-Fa-f]+|\d+)|[@(){}<>\[\]:,;=]/g,n=[],r=i.exec(e);for(;r;)n.push({value:r[0],index:r.index}),r=i.exec(e);return n}function Kn(t){let e=[],i=0;for(let n of t){if(n.value==="}"&&i===0)return null;e.push(i),n.value==="{"?i++:n.value==="}"&&i--}return i===0?e:null}function Yn(t,e){let i=new Map;for(let n=0;n<t.length;n++){if(e[n]!==0||t[n].value!=="alias")continue;let r=t[n+1]?.value;if(!_e(r)||t[n+2]?.value!=="="||i.has(r))return null;let o=_i(t,e,n+3,";");if(o<0||o===n+3)return null;i.set(r,Fe(t.slice(n+3,o))),n=o}return i}function Jn(t,e){let i=new Map;for(let n=0;n<t.length;n++){if(e[n]!==0||t[n].value!=="struct")continue;let r=t[n+1]?.value,o=n+2;if(!_e(r)||i.has(r)||t[o]?.value!=="{")return null;let s=mt(t,o,"{","}");if(s<0)return null;i.set(r,t.slice(o+1,s)),n=s}return i}function Qn(t,e,i){let n=[],r=new Set,o=new Set;for(let s=0;s<t.length;s++){if(e[s]!==0||t[s].value!=="var")continue;let a=bi(t,e,s),u=t.slice(a,s),f=ht(u,"group"),l=ht(u,"binding");if(f===null||l===null||f===void 0!=(l===void 0))return null;if(f===void 0||l===void 0)continue;let d=s+1,h=[];if(t[d]?.value==="<"){let b=mt(t,d,"<",">");if(b<0)return null;let N=Ge(t.slice(d+1,b),",");if(!N)return null;h=N.map(Fe),d=b+1}let c=t[d]?.value;if(!_e(c)||t[d+1]?.value!==":")return null;let p=_i(t,e,d+2,";");if(p<0||p===d+2)return null;let g=gt(Fe(t.slice(d+2,p)),i);if(!g)return null;let m=er({name:c,group:f,location:l,addressSpace:h,resourceType:g}),v=`${f}:${l}`;if(!m||r.has(v)||o.has(c))return null;n.push(m),r.add(v),o.add(c),s=p}return nr(n),n.sort((s,a)=>s.group-a.group||s.location-a.location||s.name.localeCompare(a.name))}function er(t){let{name:e,group:i,location:n,addressSpace:r,resourceType:o}=t,s={name:e,group:i,location:n};if(r[0]==="uniform"&&r.length===1)return{...s,type:"uniform"};if(r[0]==="storage"&&r.length<=2){let a=r[1]||"read";return a==="read"?{...s,type:"read-only-storage"}:a==="read_write"?{...s,type:"storage"}:null}return r.length>0?null:o==="sampler"||o==="sampler_comparison"?{...s,type:"sampler",...o==="sampler_comparison"?{samplerType:"comparison"}:{}}:o==="texture_external"?{...s,type:"external-texture"}:tr(s,o)||ir(s,o)}function tr(t,e){let i=/^texture_storage_(1d|2d|2d_array|3d)<([A-Za-z0-9_]+),(read|write|read_write)>$/.exec(e);if(!i)return null;let n={read:"read-only",write:"write-only",read_write:"read-write"}[i[3]];return{...t,type:"storage",format:i[2],access:n,viewDimension:pt(i[1])}}function ir(t,e){let i=/^texture_(multisampled_)?(1d|2d|2d_array|cube|cube_array|3d)<(f32|i32|u32)>$/.exec(e);if(i){if(i[1]&&i[2]!=="2d")return null;let r={f32:"float",i32:"sint",u32:"uint"}[i[3]];return{...t,type:"texture",viewDimension:pt(i[2]),sampleType:r,multisampled:!!i[1]}}let n=/^texture_depth_(multisampled_)?(2d|2d_array|cube|cube_array)$/.exec(e);return!n||n[1]&&n[2]!=="2d"?null:{...t,type:"texture",viewDimension:pt(n[2]),sampleType:"depth",multisampled:!!n[1]}}function nr(t){for(let e of t){if(e.type!=="sampler"||e.samplerType||!e.name.endsWith("Sampler"))continue;let i=e.name.slice(0,-7);t.find(r=>r.type==="texture"&&r.name===i&&r.group===e.group)?.sampleType==="depth"&&(e.samplerType="non-filtering")}}function rr(t,e,i,n,r){let o=or(t,e);if(!o)return null;let s=o.filter(c=>c.vertex),a=r?s.find(c=>c.name===r):s.length===1?s[0]:void 0;if(!a)return s.length===0&&!r?[]:null;let u=Ge(a.parameters,",");if(!u)return null;let f=[],l=new Set,d=new Set,h=new Set;for(let c of u)if(c.length>0&&!gi({declaration:c,aliases:i,structures:n,attributes:f,attributeLocations:l,attributeNames:d,visitedStructures:h}))return null;return f.sort((c,p)=>c.location-p.location||c.name.localeCompare(p.name))}function or(t,e){let i=[],n=new Set;for(let r=0;r<t.length;r++){if(e[r]!==0||t[r].value!=="fn")continue;let o=t[r+1]?.value,s=r+2;if(!_e(o)||n.has(o)||t[s]?.value!=="(")return null;let a=mt(t,s,"(",")");if(a<0)return null;let u=bi(t,e,r);i.push({name:o,vertex:mi(t.slice(u,r),"vertex"),parameters:t.slice(s+1,a)}),n.add(o),r=a}return i}function gi(t){let{declaration:e,aliases:i,structures:n,attributes:r,attributeLocations:o,attributeNames:s,visitedStructures:a}=t,u=ur(e,":");if(u<1||u===e.length-1)return!1;let f=fr(e.slice(0,u)),l=ht(e.slice(0,u),"location"),d=mi(e.slice(0,u),"builtin"),h=gt(Fe(e.slice(u+1)),i);if(!f||l===null||!h||l!==void 0&&d)return!1;if(l!==void 0){let g=ar(h);return!g||o.has(l)||s.has(f)?!1:(r.push({name:f,location:l,type:g}),o.add(l),s.add(f),!0)}if(d)return!0;let c=n.get(h);if(!c||a.has(h))return!1;let p=Ge(c,",");if(!p)return!1;a.add(h);for(let g of p)if(g.length>0&&!gi({...t,declaration:g}))return!1;return a.delete(h),!0}function gt(t,e,i=new Set){let n=pi(t),r="";for(let o of n){let s=e.get(o.value);if(!s){r+=sr(o.value);continue}if(i.has(o.value))return null;let a=new Set(i);a.add(o.value);let u=gt(s,e,a);if(!u)return null;r+=u}return r}function sr(t){let e=/^(vec[234]|mat[234]x[234])([fiuh])$/.exec(t);if(!e)return t;let i={f:"f32",i:"i32",u:"u32",h:"f16"}[e[2]];return`${e[1]}<${i}>`}function ar(t){return/^(?:i32|u32|f32|f16|vec[234]<(?:i32|u32|f32|f16)>)$/.test(t)?t:null}function ht(t,e){let i;for(let n=0;n<t.length;n++)if(!(t[n].value!=="@"||t[n+1]?.value!==e)){if(i!==void 0||t[n+2]?.value!=="("||!/^\d+$/.test(t[n+3]?.value||"")||t[n+4]?.value!==")")return null;i=Number(t[n+3].value)}return i}function mi(t,e){return t.some((i,n)=>i.value==="@"&&t[n+1]?.value===e)}function pt(t){return t.replace("_","-")}function mt(t,e,i,n){let r=0;for(let o=e;o<t.length;o++)if(t[o].value===i)r++;else if(t[o].value===n&&--r===0)return o;return-1}function Ge(t,e){let i=[],n=0,r={"(":0,"<":0,"[":0,"{":0},o=Object.keys(r),s={")":"(",">":"<","]":"[","}":"{"};for(let a=0;a<t.length;a++){let u=t[a].value;if(u===e&&o.every(f=>r[f]===0)){i.push(t.slice(n,a)),n=a+1;continue}if(u in r)r[u]++;else if(u in s){let f=s[u];if(r[f]--,r[f]<0)return null}}return o.every(a=>r[a]===0)?(i.push(t.slice(n)),i):null}function ur(t,e){let i=Ge(t,e);return i&&i.length===2?i[0].length:-1}function _i(t,e,i,n){for(let r=i;r<t.length;r++)if(e[r]===0&&t[r].value===n)return r;return-1}function bi(t,e,i){for(let n=i-1;n>=0;n--)if(t[n].value===";"&&e[n]===0||t[n].value==="}"&&e[n]===1)return n+1;return 0}function fr(t){for(let e=t.length-1;e>=0;e--)if(_e(t[e].value))return t[e].value;return null}function Fe(t){return t.map(e=>e.value).join("")}function _e(t){return!!(t&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(t))}function $(t,e){if(!t){let i=new Error(e||"shadertools: assertion failed.");throw Error.captureStackTrace?.(i,$),i}}var _t={number:{type:"number",validate(t,e){return Number.isFinite(t)&&typeof e=="object"&&(e.max===void 0||t<=e.max)&&(e.min===void 0||t>=e.min)}},array:{type:"array",validate(t,e){return Array.isArray(t)||ArrayBuffer.isView(t)}}};function vi(t){let e={};for(let[i,n]of Object.entries(t))e[i]=lr(n);return e}function lr(t){let e=yi(t);if(e!=="object")return{value:t,..._t[e],type:e};if(typeof t=="object")return t?t.type!==void 0?{...t,..._t[t.type],type:t.type}:t.value===void 0?{type:"object",value:t}:(e=yi(t.value),{...t,..._t[e],type:e}):{type:"object",value:null};throw new Error("props")}function yi(t){return Array.isArray(t)||ArrayBuffer.isView(t)?"array":typeof t}var xi=`#ifdef MODULE_LOGDEPTH
  logdepth_adjustPosition(gl_Position);
#endif
`,wi=`#ifdef MODULE_MATERIAL
  fragColor = material_filterColor(fragColor);
#endif

#ifdef MODULE_LIGHTING
  fragColor = lighting_filterColor(fragColor);
#endif

#ifdef MODULE_FOG
  fragColor = fog_filterColor(fragColor);
#endif

#ifdef MODULE_PICKING
  fragColor = picking_filterHighlightColor(fragColor);
  fragColor = picking_filterPickingColor(fragColor);
#endif

#ifdef MODULE_LOGDEPTH
  logdepth_setFragDepth();
#endif
`;var cr={vertex:xi,fragment:wi},Li=/void\s+main\s*\([^)]*\)\s*\{\n?/,Si=/}\n?[^{}]*$/,bt=[],be="__LUMA_INJECT_DECLARATIONS__";function Ei(t){let e={vertex:{},fragment:{}};for(let i in t){let n=t[i],r=dr(i);typeof n=="string"&&(n={order:0,injection:n}),e[r][i]=n}return e}function dr(t){let e=t.slice(0,2);switch(e){case"vs":return"vertex";case"fs":return"fragment";default:throw new Error(e)}}function ye(t,e,i,n=!1,r="glsl",o={}){let s=e==="vertex";for(let a in i){let u=i[a];u.sort((l,d)=>l.order-d.order),bt.length=u.length;for(let l=0,d=u.length;l<d;++l)bt[l]=u[l].injection;let f=`${bt.join(`
`)}
`;switch(a){case"vs:#decl":(r==="wgsl"||s)&&(t=t.replace(be,f));break;case"vs:#main-start":(r==="wgsl"||s)&&(t=r==="wgsl"?Ue(t,"vertex",f,"start",o.vertex):t.replace(Li,l=>l+f));break;case"vs:#main-end":(r==="wgsl"||s)&&(t=r==="wgsl"?Ue(t,"vertex",f,"end",o.vertex):t.replace(Si,l=>f+l));break;case"fs:#decl":(r==="wgsl"||!s)&&(t=t.replace(be,f));break;case"fs:#main-start":(r==="wgsl"||!s)&&(t=r==="wgsl"?Ue(t,"fragment",f,"start",o.fragment):t.replace(Li,l=>l+f));break;case"fs:#main-end":(r==="wgsl"||!s)&&(t=r==="wgsl"?Ue(t,"fragment",f,"end",o.fragment):t.replace(Si,l=>f+l));break;default:t=t.replace(a,l=>l+f)}}return t=t.replace(be,""),n&&(t=t.replace(/\}\s*$/,a=>a+cr[e])),t}function Ue(t,e,i,n,r){let o=hr(t,e,r);if(!o)return t;if(n==="start"){let s=o.openBraceIndex+1;return`${t.slice(0,s)}
${i}${t.slice(s)}`}return`${t.slice(0,o.closeBraceIndex)}${i}${t.slice(o.closeBraceIndex)}`}function hr(t,e,i){let n=e==="vertex"?"@vertex":"@fragment",r=t.indexOf(n);if(r<0)return null;let o=i?t.search(new RegExp(`\\bfn\\s+${pr(i)}\\s*\\(`)):t.indexOf("fn",r);if(o<0)return null;let s=t.indexOf("{",o);if(s<0)return null;let a=0;for(let u=s;u<t.length;u++){let f=t[u];if(f==="{")a++;else if(f==="}"&&(a--,a===0))return{openBraceIndex:s,closeBraceIndex:u}}return null}function pr(t){return t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function oe(t){t.map(e=>gr(e))}function gr(t){if(t.instance)return;oe(t.dependencies||[]);let{propTypes:e={},deprecations:i=[],inject:n={}}=t,r={normalizedInjections:Ei(n),parsedDeprecations:mr(i)};e&&(r.propValidators=vi(e)),t.instance=r;let o={};e&&(o=Object.entries(e).reduce((s,[a,u])=>{let f=u?.value;return f&&(s[a]=f),s},{})),t.defaultUniforms={...t.defaultUniforms,...o}}function yt(t,e,i){t.deprecations?.forEach(n=>{n.regex?.test(e)&&(n.deprecated?i.deprecated(n.old,n.new)():i.removed(n.old,n.new)())})}function mr(t){return t.forEach(e=>{e.type==="function"?e.regex=new RegExp(`\\b${e.old}\\(`):e.regex=new RegExp(`${e.type} ${e.old};`)}),t}function X(t){oe(t);let e={},i={};Ai({modules:t,level:0,moduleMap:e,moduleDepth:i});let n=Object.keys(i).sort((r,o)=>i[o]-i[r]).map(r=>e[r]);return oe(n),n}function Ai(t){let{modules:e,level:i,moduleMap:n,moduleDepth:r}=t;if(i>=5)throw new Error("Possible loop in shader dependency graph");for(let o of e)n[o.name]=o,(r[o.name]===void 0||r[o.name]<i)&&(r[o.name]=i);for(let o of e)o.dependencies&&Ai({modules:o.dependencies,level:i+1,moduleMap:n,moduleDepth:r})}var _r=/^(vs|fs):(?:#(?:decl|main-start|main-end)|[A-Za-z_][\w-]*)$/;function ve(t=[],e){let i=[],n={},r={},o={},s={};for(let a of t)Bi({modules:i,defines:n,injections:r,vertexInputs:o,varyings:s},a),Bi({modules:i,defines:n,injections:r,vertexInputs:o,varyings:s},a[e]);for(let a of Object.keys(s))if(o[a])throw new Error(`ShaderPlugin name "${a}" cannot be both a vertex input and a varying`);return{modules:i,defines:n,injections:r,vertexInputs:o,varyings:s}}function xe(t=[],e=[]){let i=[...t],n=new Set(i.map(r=>r.name));for(let r of e)n.has(r.name)||(i.push(r),n.add(r.name));return i}function Bi(t,e){if(e){e.modules?.length&&t.modules.push(...e.modules),e.defines&&Object.assign(t.defines,e.defines);for(let[i,n]of Object.entries(e.vertexInputs||{})){Ii(i,"vertex input");let r=t.vertexInputs[i];if(r&&r!==n)throw new Error(`ShaderPlugin vertex input "${i}" has conflicting types "${r}" and "${n}"`);t.vertexInputs[i]=n}for(let[i,n]of Object.entries(e.varyings||{})){Ii(i,"varying");let r=br(i,n),o=t.varyings[i];if(o&&(o.type!==r.type||o.interpolation!==r.interpolation))throw new Error(`ShaderPlugin varying "${i}" has conflicting declarations "${o.type}/${o.interpolation}" and "${r.type}/${r.interpolation}"`);t.varyings[i]=r}for(let i of e.injections||[])yr(i.target),t.injections[i.target]||(t.injections[i.target]=[]),t.injections[i.target].push({injection:i.injection,order:i.order??0})}}function Ii(t,e){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)||t.startsWith("_luma_"))throw new Error(`ShaderPlugin ${e} "${t}" must be a valid non-reserved identifier`)}function br(t,e){let{primitiveType:i}=W.getAttributeShaderTypeInfo(e.type),n=i==="i32"||i==="u32",r=e.interpolation||(n?"flat":"smooth");if(n&&r==="smooth")throw new Error(`ShaderPlugin integer varying "${t}" must use flat interpolation`);return{type:e.type,interpolation:r}}function yr(t){if(!_r.test(t))throw new Error(`ShaderPlugin injection target "${t}" must be a named shader anchor or hook`)}var vr=/^(?:uniform\s+)?(?:(?:lowp|mediump|highp)\s+)?[A-Za-z0-9_]+(?:<[^>]+>)?\s+([A-Za-z0-9_]+)(?:\s*\[[^\]]+\])?\s*;/,xr=/((?:layout\s*\([^)]*\)\s*)*)uniform\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}\s*([A-Za-z_][A-Za-z0-9_]*)?\s*;/g;function we(t){return`${t.name}Uniforms`}function Oi(t,e){let i=e==="wgsl"?t.source:e==="vertex"?t.vs:t.fs;if(!i)return null;let n=we(t);return wr(i,e==="wgsl"?"wgsl":"glsl",n)}function Pi(t,e){let i=Object.keys(t.uniformTypes||{});if(!i.length)return null;let n=Oi(t,e);return n?{moduleName:t.name,uniformBlockName:we(t),stage:e,expectedUniformNames:i,actualUniformNames:n,matches:Er(i,n)}:null}function vt(t,e,i={}){let n=Pi(t,e);if(!n||n.matches)return n;let r=Ar(n);return i.log?.error?.(r,n)(),i.throwOnError!==!1&&$(!1,r),n}function Le(t){let e=[],i=Br(t);for(let n of i.matchAll(xr)){let r=n[1]?.trim()||null;e.push({blockName:n[2],body:n[3],instanceName:n[4]||null,layoutQualifier:r,hasLayoutQualifier:!!r,isStd140:!!(r&&/\blayout\s*\([^)]*\bstd140\b[^)]*\)/.exec(r))})}return e}function xt(t,e,i,n){let r=Le(t).filter(s=>!s.isStd140),o=new Set;for(let s of r){if(o.has(s.blockName))continue;o.add(s.blockName);let a=n?.label?`${n.label} `:"",u=s.hasLayoutQualifier?`declares ${Ir(s.layoutQualifier)} instead of layout(std140)`:"does not declare layout(std140)",f=`${a}${e} shader uniform block ${s.blockName} ${u}. luma.gl host-side shader block packing assumes explicit layout(std140) for GLSL uniform blocks. Add \`layout(std140)\` to the block declaration.`;i?.warn?.(f,s)()}return r}function wr(t,e,i){let n=e==="wgsl"?Lr(t,i):Sr(t,i);if(!n)return null;let r=[];for(let o of n.split(`
`)){let s=o.replace(/\/\/.*$/,"").trim();if(!s||s.startsWith("#"))continue;let a=e==="wgsl"?s.match(/^([A-Za-z0-9_]+)\s*:/):s.match(vr);a&&r.push(a[1])}return r}function Lr(t,e){let i=new RegExp(`\\bstruct\\s+${e}\\b`,"m").exec(t);if(!i)return null;let n=t.indexOf("{",i.index);if(n<0)return null;let r=0;for(let o=n;o<t.length;o++){let s=t[o];if(s==="{"){r++;continue}if(s==="}"&&(r--,r===0))return t.slice(n+1,o)}return null}function Sr(t,e){return Le(t).find(n=>n.blockName===e)?.body||null}function Er(t,e){if(t.length!==e.length)return!1;for(let i=0;i<t.length;i++)if(t[i]!==e[i])return!1;return!0}function Ar(t){let{expectedUniformNames:e,actualUniformNames:i}=t,n=e.filter(a=>!i.includes(a)),r=i.filter(a=>!e.includes(a)),o=[`Expected ${e.length} fields, found ${i.length}.`],s=Tr(e,i);return s&&o.push(s),n.length&&o.push(`Missing from shader block (${n.length}): ${Ti(n)}.`),r.length&&o.push(`Unexpected in shader block (${r.length}): ${Ti(r)}.`),e.length<=12&&i.length<=12&&(n.length||r.length)&&(o.push(`Expected: ${e.join(", ")}.`),o.push(`Actual: ${i.join(", ")}.`)),`${t.moduleName}: ${t.stage} shader uniform block ${t.uniformBlockName} does not match module.uniformTypes. ${o.join(" ")}`}function Br(t){return t.replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/.*$/gm,"")}function Ir(t){return t.replace(/\s+/g," ").trim()}function Tr(t,e){let i=Math.min(t.length,e.length);for(let n=0;n<i;n++)if(t[n]!==e[n])return`First mismatch at field ${n+1}: expected ${t[n]}, found ${e[n]}.`;return t.length>e.length?`Shader block ends after field ${e.length}; expected next field ${t[e.length]}.`:e.length>t.length?`Shader block has extra field ${e.length}: ${e[t.length]}.`:null}function Ti(t,e=8){if(t.length<=e)return t.join(", ");let i=t.length-e;return`${t.slice(0,e).join(", ")}, ... (${i} more)`}function Ci(t){switch(t?.gpu.toLowerCase()){case"apple":return`#define APPLE_GPU
// Apple optimizes away the calculation necessary for emulated fp64
#define LUMA_FP64_CODE_ELIMINATION_WORKAROUND 1
#define LUMA_FP32_TAN_PRECISION_WORKAROUND 1
// Intel GPU doesn't have full 32 bits precision in same cases, causes overflow
#define LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND 1
`;case"nvidia":return`#define NVIDIA_GPU
// Nvidia optimizes away the calculation necessary for emulated fp64
#define LUMA_FP64_CODE_ELIMINATION_WORKAROUND 1
`;case"intel":return`#define INTEL_GPU
// Intel optimizes away the calculation necessary for emulated fp64
#define LUMA_FP64_CODE_ELIMINATION_WORKAROUND 1
// Intel's built-in 'tan' function doesn't have acceptable precision
#define LUMA_FP32_TAN_PRECISION_WORKAROUND 1
// Intel GPU doesn't have full 32 bits precision in same cases, causes overflow
#define LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND 1
`;case"amd":return`#define AMD_GPU
`;default:return`#define DEFAULT_GPU
// Prevent driver from optimizing away the calculation necessary for emulated fp64
#define LUMA_FP64_CODE_ELIMINATION_WORKAROUND 1
// Headless Chrome's software shader 'tan' function doesn't have acceptable precision
#define LUMA_FP32_TAN_PRECISION_WORKAROUND 1
// If the GPU doesn't have full 32 bits precision, will causes overflow
#define LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND 1
`}}function Ri(t,e){if(Number(t.match(/^#version[ \t]+(\d+)/m)?.[1]||100)!==300)throw new Error("luma.gl v9 only supports GLSL 3.00 shader sources");switch(e){case"vertex":return t=Ni(t,Or),t;case"fragment":return t=Ni(t,Pr),t;default:throw new Error(e)}}var Di=[[/^(#version[ \t]+(100|300[ \t]+es))?[ \t]*\n/,`#version 300 es
`],[/\btexture(2D|2DProj|Cube)Lod(EXT)?\(/g,"textureLod("],[/\btexture(2D|2DProj|Cube)(EXT)?\(/g,"texture("]],Or=[...Di,[wt("attribute"),"in $1"],[wt("varying"),"out $1"]],Pr=[...Di,[wt("varying"),"in $1"]];function Ni(t,e){for(let[i,n]of e)t=t.replace(i,n);return t}function wt(t){return new RegExp(`\\b${t}[ \\t]+(\\w+[ \\t]+\\w+(\\[\\w+\\])?;)`,"g")}function $e(t,e,i="glsl"){let n="";for(let r in t){let o=t[r];if(n+=`${i==="wgsl"?"fn":"void"} ${o.signature} {
`,o.header&&(n+=`  ${o.header}`),e[r]){let a=e[r];a.sort((u,f)=>u.order-f.order);for(let u of a)n+=`  ${u.injection}
`}o.footer&&(n+=`  ${o.footer}`),n+=`}
`}return n}function Lt(t){let e={vertex:{},fragment:{}};for(let i of t){let n,r;typeof i!="string"?(n=i,r=n.hook):(n={},r=i),r=r.trim();let o=r.indexOf(":"),s=r.slice(0,o),a=r.slice(o+1),u=r.replace(/\(.+/,""),f=Object.assign(n,{signature:a});switch(s){case"vs":e.vertex[u]=f;break;case"fs":e.fragment[u]=f;break;default:throw new Error(s)}}return e}function Fi(t,e){return{name:Cr(t,e),language:"glsl",version:Nr(t)}}function Cr(t,e="unnamed"){let n=/#define[^\S\r\n]*SHADER_NAME[^\S\r\n]*([A-Za-z0-9_-]+)\s*/.exec(t);return n?n[1]:e}function Nr(t){let e=100,i=t.match(/[^\s]+/g);if(i&&i.length>=2&&i[0]==="#version"){let n=parseInt(i[1],10);Number.isFinite(n)&&(e=n)}if(e!==100&&e!==300)throw new Error(`Invalid GLSL version ${e}`);return e}var Mi=[new RegExp(`@binding\\(\\s*(\\d+)\\s*\\)\\s*@group\\(\\s*(\\d+)\\s*\\)\\s*${C}\\s*:\\s*([^;]+);`,"g"),new RegExp(`@group\\(\\s*(\\d+)\\s*\\)\\s*@binding\\(\\s*(\\d+)\\s*\\)\\s*${C}\\s*:\\s*([^;]+);`,"g")];function ke(t,e=[]){let i=re(t),n=new Map;for(let o of e)n.set(Gi(o.name,o.group,o.location),o.moduleName);let r=[];for(let o of Mi){o.lastIndex=0;let s;for(s=o.exec(i);s;){let a=o===Mi[0],u=Number(s[a?1:2]),f=Number(s[a?2:1]),l=s[3]?.trim(),d=s[4],h=s[5].trim(),c=n.get(Gi(d,f,u));r.push(Rr({name:d,group:f,binding:u,owner:c?"module":"application",moduleName:c,accessDeclaration:l,resourceType:h})),s=o.exec(i)}}return r.sort((o,s)=>o.group!==s.group?o.group-s.group:o.binding!==s.binding?o.binding-s.binding:o.name.localeCompare(s.name))}function Rr(t){let e={name:t.name,group:t.group,binding:t.binding,owner:t.owner,kind:"unknown",moduleName:t.moduleName,resourceType:t.resourceType};if(t.accessDeclaration){let i=t.accessDeclaration.split(",").map(n=>n.trim());if(i[0]==="uniform")return{...e,kind:"uniform",access:"uniform"};if(i[0]==="storage"){let n=i[1]||"read_write";return{...e,kind:n==="read"?"read-only-storage":"storage",access:n}}}return t.resourceType==="sampler"||t.resourceType==="sampler_comparison"?{...e,kind:"sampler",samplerKind:t.resourceType==="sampler_comparison"?"comparison":"filtering"}:t.resourceType.startsWith("texture_storage_")?{...e,kind:"storage-texture",access:Fr(t.resourceType),viewDimension:Ui(t.resourceType)}:t.resourceType.startsWith("texture_")?{...e,kind:"texture",viewDimension:Ui(t.resourceType),sampleType:Dr(t.resourceType),multisampled:t.resourceType.startsWith("texture_multisampled_")}:e}function Gi(t,e,i){return`${e}:${i}:${t}`}function Ui(t){if(t.includes("cube_array"))return"cube-array";if(t.includes("2d_array"))return"2d-array";if(t.includes("cube"))return"cube";if(t.includes("3d"))return"3d";if(t.includes("2d"))return"2d";if(t.includes("1d"))return"1d"}function Dr(t){if(t.startsWith("texture_depth_"))return"depth";if(t.includes("<i32>"))return"sint";if(t.includes("<u32>"))return"uint";if(t.includes("<f32>"))return"float"}function Fr(t){return/,\s*([A-Za-z_][A-Za-z0-9_]*)\s*>$/.exec(t)?.[1]}var K="([a-zA-Z_][a-zA-Z0-9_]*)",Mr=/^\s*\#\s*if\s+(.+?)\s*(?:\/\/.*)?$/,Gr=new RegExp(`^\\s*\\#\\s*ifdef\\s*${K}\\s*$`),Ur=new RegExp(`^\\s*\\#\\s*ifndef\\s*${K}\\s*(?:\\/\\/.*)?$`),$r=/^\s*\#\s*else\s*(?:\/\/.*)?$/,kr=/^\s*\#\s*endif\s*$/,zr=new RegExp(`^\\s*\\#\\s*ifdef\\s*${K}\\s*(?:\\/\\/.*)?$`),Vr=/^\s*\#\s*endif\s*(?:\/\/.*)?$/;function Y(t,e){let i=t.split(`
`),n=[],r=[],o=!0;for(let s of i){let a=s.match(Mr),u=s.match(zr)||s.match(Gr),f=s.match(Ur),l=s.match($r),d=s.match(Vr)||s.match(kr);if(a){let h=Wr(a[1],e?.defines||{}),c=o&&h;r.push({parentActive:o,branchTaken:h,active:c}),o=c}else if(u||f){let h=(u||f)?.[1],c=!!e?.defines?.[h],p=u?c:!c,g=o&&p;r.push({parentActive:o,branchTaken:p,active:g}),o=g}else if(l){let h=r[r.length-1];if(!h)throw new Error("Encountered #else without matching #if, #ifdef or #ifndef");h.active=h.parentActive&&!h.branchTaken,h.branchTaken=!0,o=h.active}else d?(r.pop(),o=r.length?r[r.length-1].active:!0):o&&n.push(s)}if(r.length>0)throw new Error("Unterminated conditional block in shader source");return n.join(`
`)}function Wr(t,e){let i=t.trim();if(/^[+-]?\d+(?:\.\d+)?$/.test(i))return Number(i)!==0;if(i==="true")return!0;if(i==="false")return!1;let n=i.match(new RegExp(`^!\\s*${K}$`));if(n)return!e[n[1]];let r=i.match(new RegExp(`^${K}$`));if(r)return!!e[r[1]];let o=i.match(new RegExp(`^defined\\s*\\(\\s*${K}\\s*\\)$`));if(o)return e[o[1]]!==void 0;let s=i.match(new RegExp(`^!\\s*defined\\s*\\(\\s*${K}\\s*\\)$`));if(s)return e[s[1]]===void 0;throw new Error(`Unsupported #if expression "${t}"`)}function zi(t,e){let i=[];for(let[n,r]of Object.entries(e))jr(t,n),i.push(`in ${ze(r)} ${n};`);return i.join(`
`)}function Vi(t,e,i){let n=Object.entries(i);if(n.length===0)return{source:t,declarations:"",initialization:""};let r=Hr(t,e),o=t.slice(r.openParenthesis+1,r.closeParenthesis),s=qr(t,o),a=new Set(s.locations),u=[],f=[],l=[];for(let[g,m]of n){if(s.names.has(g)||Kr(t,g))throw new Error(`ShaderPlugin vertex input "${g}" conflicts with an existing WGSL shader input or variable`);let v=Yr(a);a.add(v);let b=`_luma_${g}`;u.push(`@location(${v}) ${b}: ${m}`),f.push(`var<private> ${g}: ${m};`),l.push(`${g} = ${b};`)}let d=o.trim()?`,
  `:`
  `,h=o.trim()?"":`
`,c=`${o}${d}${u.join(`,
  `)}${h}`;return{source:t.slice(0,r.openParenthesis+1)+c+t.slice(r.closeParenthesis),declarations:f.join(`
`),initialization:l.join(`
`)}}function ze(t){let{primitiveType:e,components:i}=W.getAttributeShaderTypeInfo(t),n=e==="i32"?"int":e==="u32"?"uint":"float";return i===1?n:`${n==="int"?"i":n==="uint"?"u":""}vec${i}`}function jr(t,e){let i=Ve(e);if(new RegExp(`\\b(?:in|attribute)\\s+(?:(?:lowp|mediump|highp)\\s+)?[A-Za-z_][A-Za-z0-9_]*\\s+${i}\\s*(?:\\[|;)`).test(t))throw new Error(`ShaderPlugin vertex input "${e}" conflicts with an existing GLSL input`)}function Hr(t,e){let n=new RegExp(`\\bfn\\s+${Ve(e)}\\s*\\(`,"g").exec(t);if(!n)throw new Error(`ShaderPlugin vertex inputs require WGSL vertex entry point "${e}"`);let r=t.indexOf("(",n.index),o=Wi(t,r,"(",")");if(o<0)throw new Error(`Unable to parse WGSL vertex entry point "${e}" parameters`);return{openParenthesis:r,closeParenthesis:o}}function qr(t,e){let i=$i(e),n=new Set(ki(e)),r=Zr(e);for(let o of r){let s=Xr(t,o);if(s!==null){i.push(...$i(s));for(let a of ki(s))n.add(a)}}return{locations:i,names:n}}function $i(t){let e=[],i=/@location\s*\(\s*(\d+)\s*\)/g,n=i.exec(t);for(;n;)e.push(Number(n[1])),n=i.exec(t);return e}function ki(t){let e=[],i=/(?:^|,)\s*(?:@[A-Za-z_][\w]*(?:\([^)]*\))?\s*)*([A-Za-z_][\w]*)\s*:/gm,n=i.exec(t);for(;n;)e.push(n[1]),n=i.exec(t);return e}function Zr(t){let e=[],i=/:\s*([A-Za-z_][\w]*)\b/g,n=i.exec(t);for(;n;)e.push(n[1]),n=i.exec(t);return e}function Xr(t,e){let n=new RegExp(`\\bstruct\\s+${Ve(e)}\\s*\\{`,"g").exec(t);if(!n)return null;let r=t.indexOf("{",n.index),o=Wi(t,r,"{","}");return o<0?null:t.slice(r+1,o)}function Kr(t,e){let i=Ve(e),n=new RegExp(`\\b(?:var(?:<[^>]+>)?|let|const)\\s+${i}\\b`,"g"),r=n.exec(t);for(;r;){if(Jr(t,r.index)===0)return!0;r=n.exec(t)}return!1}function Yr(t){let e=0;for(;t.has(e);)e++;return e}function Wi(t,e,i,n){let r=0,o=0,s=!1;for(let a=e;a<t.length;a++){let u=t[a],f=t[a+1];if(s){u===`
`&&(s=!1);continue}if(o>0){u==="/"&&f==="*"?(o++,a++):u==="*"&&f==="/"&&(o--,a++);continue}if(u==="/"&&f==="/"){s=!0,a++;continue}if(u==="/"&&f==="*"){o=1,a++;continue}if(u===i&&r++,u===n&&--r===0)return a}return-1}function Jr(t,e){let i=0,n=0,r=!1;for(let o=0;o<e;o++){let s=t[o],a=t[o+1];if(r){s===`
`&&(r=!1);continue}if(n>0){s==="/"&&a==="*"?(n++,o++):s==="*"&&a==="/"&&(n--,o++);continue}s==="/"&&a==="/"?(r=!0,o++):s==="/"&&a==="*"?(n=1,o++):s==="{"?i++:s==="}"&&i--}return i}function Ve(t){return t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function Hi(t,e,i){let n=[],r=[];for(let[o,s]of Object.entries(i)){co(t,o);let a=s.interpolation==="flat"?"flat ":"",u=e==="vertex"?"out":"in";n.push(`${a}${u} ${ze(s.type)} ${o};`),e==="vertex"&&r.push(`${o} = ${fo(s.type)};`)}return{declarations:n.join(`
`),initialization:r.join(`
`)}}function qi(t,e,i,n){let r=Object.entries(n);if(r.length===0)return{source:t,declarations:"",vertexInitialization:"",fragmentInitialization:""};let o=t,s=We(o,e,"vertex"),a=Qr(o,s),u=We(o,i,"fragment"),f=eo(o,u),l=St(o,a),d=St(o,f.type),h=new Set([...je(s.parameters),...je(l.body),...je(u.parameters),...je(d.body)]),c=new Set([...ji(l.body),...ji(d.body)]),p=[],g=[],m=[],v=[];for(let[y,L]of r){if(h.has(y)||ao(o,y))throw new Error(`ShaderPlugin varying "${y}" conflicts with existing WGSL stage I/O or a module variable`);let B=uo(c);c.add(B);let P=L.interpolation==="flat"?" @interpolate(flat)":"";p.push(`  @location(${B})${P} ${y}: ${L.type},`),g.push(`var<private> ${y}: ${L.type};`),m.push(`${y} = ${lo(L.type)};`),v.push(`${y} = ${f.name}.${y};`)}to(o,a,s.openBrace,s.closeBrace),o=io(o,a,s,r.map(([y])=>y)),s=We(o,e,"vertex"),o=no(o,s,r.map(([y])=>y));let N=(a===f.type?[a]:[a,f.type]).map(y=>St(o,y).closeBrace).sort((y,L)=>L-y);for(let y of N)o=o.slice(0,y)+`${p.join(`
`)}
`+o.slice(y);if(u=We(o,i,"fragment"),!new RegExp(`\\b${J(f.name)}\\s*:`).test(u.parameters))throw new Error(`Unable to preserve WGSL fragment input "${f.name}"`);return{source:o,declarations:g.join(`
`),vertexInitialization:m.join(`
`),fragmentInitialization:v.join(`
`)}}function We(t,e,i){let r=new RegExp(`\\bfn\\s+${J(e)}\\s*\\(`,"g").exec(t);if(!r)throw new Error(`ShaderPlugin varyings require WGSL ${i} entry point "${e}"`);let o=t.indexOf("(",r.index),s=He(t,o,"(",")"),a=t.indexOf("{",s),u=He(t,a,"{","}");if(s<0||a<0||u<0)throw new Error(`Unable to parse WGSL ${i} entry point "${e}"`);return{openParenthesis:o,closeParenthesis:s,openBrace:a,closeBrace:u,parameters:t.slice(o+1,s)}}function Qr(t,e){let i=t.slice(e.closeParenthesis+1,e.openBrace),n=/->\s*([A-Za-z_][\w]*)\s*$/.exec(i.trim());if(!n||Et(t,n[1])===null)throw new Error("ShaderPlugin varyings require the WGSL vertex entry point to return a named struct");return n[1]}function eo(t,e){let i=[];for(let n of so(e.parameters,",")){let r=/(?:@[A-Za-z_][\w]*(?:\([^)]*\))?\s*)*([A-Za-z_][\w]*)\s*:\s*([A-Za-z_][\w]*)\s*$/.exec(n.trim());r&&Et(t,r[2])&&i.push({name:r[1],type:r[2]})}if(i.length!==1)throw new Error(`ShaderPlugin varyings require exactly one named WGSL fragment input struct; found ${i.length}`);return i[0]}function St(t,e){let i=Et(t,e);if(!i)throw new Error(`Unable to find WGSL stage I/O struct "${e}"`);return i}function Et(t,e){let n=new RegExp(`\\bstruct\\s+${J(e)}\\s*\\{`,"g").exec(t);if(!n)return null;let r=t.indexOf("{",n.index),o=He(t,r,"{","}");return o<0?null:{openBrace:r,closeBrace:o,body:t.slice(r+1,o)}}function to(t,e,i,n){let r=new RegExp(`\\b${J(e)}\\s*\\(`,"g"),o=r.exec(t);for(;o;){if(o.index<i||o.index>n)throw new Error(`ShaderPlugin varying output struct "${e}" is constructed outside the selected vertex entry point`);o=r.exec(t)}}function io(t,e,i,n){let r=new RegExp(`\\b${J(e)}\\s*\\(`,"g"),o=[],s=r.exec(t);for(;s;){if(s.index>i.openBrace&&s.index<i.closeBrace){let a=t.indexOf("(",s.index),u=He(t,a,"(",")");if(u<0||u>i.closeBrace)throw new Error(`Unable to parse WGSL output constructor "${e}"`);o.push({openParenthesis:a,closeParenthesis:u})}s=r.exec(t)}for(let a of o.sort((u,f)=>f.closeParenthesis-u.closeParenthesis)){let f=t.slice(a.openParenthesis+1,a.closeParenthesis).trim()?", ":"";t=t.slice(0,a.closeParenthesis)+f+n.join(", ")+t.slice(a.closeParenthesis)}return t}function no(t,e,i){let n=ro(t,e.openBrace+1,e.closeBrace);for(let r=n.length-1;r>=0;r--){let o=n[r],s=t.slice(o.expressionStart,o.semicolon).trim();if(!s)throw new Error("ShaderPlugin varying vertex entry point cannot use an empty return");let a=`_luma_vertexOutput${r}`,u=i.map(l=>`${a}.${l} = ${l};`).join(`
`),f=`{
var ${a} = ${s};
${u}
return ${a};
}`;t=t.slice(0,o.start)+f+t.slice(o.semicolon+1)}return t}function ro(t,e,i){let n=[],r=e;for(;r<i;)if(r=At(t,r,i),t.slice(r,r+6)==="return"&&!/[A-Za-z0-9_]/.test(t[r+6]||"")){let o=r+6,s=oo(t,o,i);if(s<0)throw new Error("Unable to parse WGSL return statement in selected vertex entry point");n.push({start:r,expressionStart:o,semicolon:s}),r=s+1}else r++;return n}function oo(t,e,i){let n=0,r=0;for(let o=e;o<i;o++){let s=At(t,o,i);if(s!==o){o=s-1;continue}let a=t[o];if(a==="("&&n++,a===")"&&n--,a==="["&&r++,a==="]"&&r--,a===";"&&n===0&&r===0)return o}return-1}function At(t,e,i){let n=e;if(t[n]==="/"&&t[n+1]==="/"){let r=t.indexOf(`
`,n+2);return r<0||r>i?i:r+1}if(t[n]==="/"&&t[n+1]==="*"){let r=1;for(n+=2;n<i&&r>0;)t[n]==="/"&&t[n+1]==="*"?(r++,n+=2):t[n]==="*"&&t[n+1]==="/"?(r--,n+=2):n++}return n}function so(t,e){let i=[],n=0,r=0,o=0;for(let s=0;s<t.length;s++){let a=t[s];a==="("&&r++,a===")"&&r--,a==="<"&&o++,a===">"&&o--,a===e&&r===0&&o===0&&(i.push(t.slice(n,s)),n=s+1)}return i.push(t.slice(n)),i}function ji(t){let e=[],i=/@location\s*\(\s*(\d+)\s*\)/g,n=i.exec(t);for(;n;)e.push(Number(n[1])),n=i.exec(t);return e}function je(t){let e=[],i=/(?:^|,)\s*(?:@[A-Za-z_][\w]*(?:\([^)]*\))?\s*)*([A-Za-z_][\w]*)\s*:/gm,n=i.exec(t);for(;n;)e.push(n[1]),n=i.exec(t);return e}function ao(t,e){let i=new RegExp(`\\b(?:var(?:<[^>]+>)?|let|const)\\s+${J(e)}\\b`,"g"),n=i.exec(t);for(;n;){if(ho(t,n.index)===0)return!0;n=i.exec(t)}return!1}function uo(t){let e=0;for(;t.has(e);)e++;return e}function fo(t){let{primitiveType:e,components:i}=W.getAttributeShaderTypeInfo(t),n=e==="u32"?"0u":e==="i32"?"0":"0.0";return i===1?n:`${ze(t)}(${n})`}function lo(t){let{primitiveType:e,components:i}=W.getAttributeShaderTypeInfo(t),n=`${e}(0)`;return i===1?n:`${t}(${n})`}function co(t,e){if(new RegExp(`\\b(?:flat\\s+|smooth\\s+)?(?:in|out|varying)\\s+(?:(?:lowp|mediump|highp)\\s+)?[A-Za-z_][A-Za-z0-9_]*\\s+${J(e)}\\s*(?:\\[|;)`).test(t))throw new Error(`ShaderPlugin varying "${e}" conflicts with existing GLSL stage I/O`)}function He(t,e,i,n){let r=0,o=0,s=!1;for(let a=e;a<t.length;a++){let u=t[a],f=t[a+1];if(s){u===`
`&&(s=!1);continue}if(o>0){u==="/"&&f==="*"?(o++,a++):u==="*"&&f==="/"&&(o--,a++);continue}if(u==="/"&&f==="/"){s=!0,a++;continue}if(u==="/"&&f==="*"){o=1,a++;continue}if(u===i&&r++,u===n&&--r===0)return a}return-1}function ho(t,e){let i=0;for(let n=0;n<e;n++){let r=At(t,n,e);if(r!==n){n=r-1;continue}t[n]==="{"&&i++,t[n]==="}"&&i--}return i}function J(t){return t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}var Bt=`

${be}
`,Se=100,po=`precision highp float;
`;function Ki(t){let e=X(t.modules||[]),{source:i,bindingAssignments:n}=go(t.platformInfo,{...t,source:t.source,stage:"vertex",modules:e});return{source:i,getUniforms:Ji(e),bindingAssignments:n,bindingTable:ke(i,n),shaderLayout:Me(i,{vertexEntryPoint:t.vertexEntryPoint,scanVertexAttributes:t.scanVertexAttributes})}}function Yi(t){let{vs:e,fs:i}=t,n=X(t.modules||[]);return{vs:Zi(t.platformInfo,{...t,source:e,stage:"vertex",modules:n}),fs:Zi(t.platformInfo,{...t,source:i,stage:"fragment",modules:n}),getUniforms:Ji(n)}}function go(t,e){let{source:i,stage:n,modules:r,defines:o={},hookFunctions:s=[],inject:a={},pluginInjections:u={},pluginVertexInputs:f={},pluginVaryings:l={},vertexEntryPoint:d="vertexMain",fragmentEntryPoint:h="fragmentMain",log:c}=e;$(typeof i=="string","shader source must be a string");let p=Y(i,{defines:o}),g=Vi(p,d,f),m=qi(g.source,d,h,l),v=m.source,b="",N=Lt(s),x={},y={},L={};Qi(u,x,y,L);for(let S in a){let E=typeof a[S]=="string"?{injection:a[S],order:0}:a[S],R=/^(v|f)s:(#)?([\w-]+)$/.exec(S);if(R){let Oe=R[2],G=R[3];Oe?G==="decl"?y[S]=[E]:L[S]=[E]:x[S]=[E]}else L[S]=[E]}mo(g.declarations,g.initialization,y,L),_o(m,y,L);let B=r,P=Lo(v),q=wo(P.source),w=Bo(B,e._bindingRegistry,q,o),D=[];for(let S of B){c&&yt(S,v,c);let E=Y(en(S,"wgsl",c),{defines:o}),R=So(E,S,{usedBindingsByGroup:q,bindingRegistry:e._bindingRegistry,reservedBindingKeysByGroup:w});D.push(...R.bindingAssignments);let Oe=R.source;b+=Oe;let G=bo(S);for(let U in G){let Jt=/^(v|f)s:#([\w-]+)$/.exec(U);if(Jt){let ft=Jt[2]==="decl"?y:L;ft[U]=ft[U]||[],ft[U].push(G[U])}else x[U]=x[U]||[],x[U].push(G[U])}}return b+=Bt,b=ye(b,n,yo(y),!1,"wgsl",{vertex:d,fragment:h}),b+=vo(N,x),b+=No(D),b+=P.source,b=ye(b,n,L,!1,"wgsl",{vertex:d,fragment:h}),Co(b),{source:b,bindingAssignments:D}}function Zi(t,e){let{source:i,stage:n,language:r="glsl",modules:o,defines:s={},hookFunctions:a=[],inject:u={},pluginInjections:f={},pluginVertexInputs:l={},pluginVaryings:d={},prologue:h=!0,log:c}=e;$(typeof i=="string","shader source must be a string");let p=r==="glsl"?Fi(i).version:-1,g=t.shaderLanguageVersion,m=p===100?"#version 100":"#version 300 es",b=i.split(`
`).slice(1).join(`
`),N={};o.forEach(w=>{Object.assign(N,w.defines)}),Object.assign(N,s);let x="";switch(r){case"wgsl":break;case"glsl":x=h?`${m}

// ----- PROLOGUE -------------------------
${`#define SHADER_TYPE_${n.toUpperCase()}`}

${Ci(t)}
${n==="fragment"?po:""}

// ----- APPLICATION DEFINES -------------------------

${xo(N)}

`:`${m}
`;break}let y=Lt(a),L={},B={},P={};Qi(f,L,B,P);for(let w in u){let D=typeof u[w]=="string"?{injection:u[w],order:0}:u[w],S=/^(v|f)s:(#)?([\w-]+)$/.exec(w);if(S){let E=S[2],R=S[3];E?R==="decl"?B[w]=[D]:P[w]=[D]:L[w]=[D]}else P[w]=[D]}if(n==="vertex"){let w=zi(b,l);w&&(B["vs:#decl"]=B["vs:#decl"]||[],B["vs:#decl"].push({injection:w,order:Number.MIN_SAFE_INTEGER}))}let q=Hi(b,n,d);if(q.declarations){let w=n==="vertex"?"vs:#decl":"fs:#decl";B[w]=B[w]||[],B[w].push({injection:q.declarations,order:Number.MIN_SAFE_INTEGER})}q.initialization&&(P["vs:#main-start"]=P["vs:#main-start"]||[],P["vs:#main-start"].push({injection:q.initialization,order:Number.MIN_SAFE_INTEGER}));for(let w of o){c&&yt(w,b,c);let D=en(w,n,c);x+=D;let S=w.instance?.normalizedInjections[n]||{};for(let E in S){let R=/^(v|f)s:#([\w-]+)$/.exec(E);if(R){let G=R[2]==="decl"?B:P;G[E]=G[E]||[],G[E].push(S[E])}else L[E]=L[E]||[],L[E].push(S[E])}}return x+="// ----- MAIN SHADER SOURCE -------------------------",x+=Bt,x=ye(x,n,B),x+=$e(y[n],L),x+=b,x=ye(x,n,P),r==="glsl"&&p!==g&&(x=Ri(x,n)),r==="glsl"&&xt(x,n,c),x.trim()}function Ji(t){return function(i){let n={};for(let r of t){let o=r.getUniforms?.(i,n);Object.assign(n,o)}return n}}function Qi(t,e,i,n){for(let r in t){let o=/^(v|f)s:(#)?([\w-]+)$/.exec(r);if(o){let s=o[2],a=o[3],u=s?a==="decl"?i:n:e;u[r]=u[r]||[],u[r].push(...t[r])}else n[r]=n[r]||[],n[r].push(...t[r])}}function mo(t,e,i,n){t&&(i["vs:#decl"]=i["vs:#decl"]||[],i["vs:#decl"].push({injection:t,order:Number.MIN_SAFE_INTEGER})),e&&(n["vs:#main-start"]=n["vs:#main-start"]||[],n["vs:#main-start"].push({injection:e,order:Number.MIN_SAFE_INTEGER}))}function _o(t,e,i){t.declarations&&(e["vs:#decl"]=e["vs:#decl"]||[],e["vs:#decl"].push({injection:t.declarations,order:Number.MIN_SAFE_INTEGER})),t.vertexInitialization&&(i["vs:#main-start"]=i["vs:#main-start"]||[],i["vs:#main-start"].push({injection:t.vertexInitialization,order:Number.MIN_SAFE_INTEGER})),t.fragmentInitialization&&(i["fs:#main-start"]=i["fs:#main-start"]||[],i["fs:#main-start"].push({injection:t.fragmentInitialization,order:Number.MIN_SAFE_INTEGER}))}function bo(t){return{...t.instance?.normalizedInjections.vertex||{},...t.instance?.normalizedInjections.fragment||{}}}function yo(t){let e=[...t["vs:#decl"]||[],...t["fs:#decl"]||[]];return e.length?{"vs:#decl":e}:{}}function vo(t,e){return $e(t.vertex,e,"wgsl")+$e(t.fragment,e,"wgsl")}function xo(t={}){let e="";for(let i in t){let n=t[i];(n||Number.isFinite(n))&&(e+=`#define ${i.toUpperCase()} ${t[i]}
`)}return e}function en(t,e,i){let n;switch(e){case"vertex":n=t.vs||"";break;case"fragment":n=t.fs||"";break;case"wgsl":n=t.source||"";break;default:$(!1)}if(!t.name)throw new Error("Shader module must have a name");vt(t,e,{log:i});let r=t.name.toUpperCase().replace(/[^0-9a-z]/gi,"_"),o=`// ----- MODULE ${t.name} ---------------

`;return e!=="wgsl"&&(o+=`#define MODULE_${r}
`),o+=`${n}
`,o}function wo(t){let e=new Map;for(let i of Z(t,di)){let n=Number(i.bindingToken),r=Number(i.groupToken);It(r,n,i.name),se(e,r,n,`application binding "${i.name}"`)}return e}function Lo(t){let e=Z(t,De),i=new Map;for(let o of e){if(o.bindingToken==="auto")continue;let s=Number(o.bindingToken),a=Number(o.groupToken);It(a,s,o.name),se(i,a,s,`application binding "${o.name}"`)}let n={sawSupportedBindingDeclaration:e.length>0},r=ct(t,De,o=>Ao(o,i,n));if(dt(t)&&!n.sawSupportedBindingDeclaration)throw new Error('Unsupported @binding(auto) declaration form in application WGSL. Use adjacent "@group(N)" and "@binding(auto)" decorators followed by a bindable "var" declaration.');return{source:r}}function So(t,e,i){let n=[],o={sawSupportedBindingDeclaration:Z(t,ne).length>0,nextHintedBindingLocation:typeof e.firstBindingSlot=="number"?e.firstBindingSlot:null},s=ct(t,ne,a=>Eo(a,{module:e,context:i,bindingAssignments:n,relocationState:o}));if(dt(t)&&!o.sawSupportedBindingDeclaration)throw new Error(`Unsupported @binding(auto) declaration form in module "${e.name}". Use adjacent "@group(N)" and "@binding(auto)" decorators followed by a bindable "var" declaration.`);return{source:s,bindingAssignments:n}}function Eo(t,e){let{module:i,context:n,bindingAssignments:r,relocationState:o}=e,{match:s,bindingToken:a,groupToken:u,name:f}=t,l=Number(u);if(a==="auto"){let h=tn(l,i.name,f),c=n.bindingRegistry?.get(h),p=c!==void 0?c:Oo(l,n.usedBindingsByGroup,i.name,o.nextHintedBindingLocation??void 0,n.bindingRegistry);return Xi(i.name,l,p,f),c!==void 0&&Io(n.reservedBindingKeysByGroup,l,p,h)?(r.push({moduleName:i.name,name:f,group:l,location:p}),s.replace(/@binding\(\s*auto\s*\)/,`@binding(${p})`)):(se(n.usedBindingsByGroup,l,p,`module "${i.name}" binding "${f}"`),n.bindingRegistry?.set(h,p),r.push({moduleName:i.name,name:f,group:l,location:p}),o.nextHintedBindingLocation!==null&&c===void 0&&(o.nextHintedBindingLocation=p+1),s.replace(/@binding\(\s*auto\s*\)/,`@binding(${p})`))}let d=Number(a);return Xi(i.name,l,d,f),se(n.usedBindingsByGroup,l,d,`module "${i.name}" binding "${f}"`),r.push({moduleName:i.name,name:f,group:l,location:d}),s}function Ao(t,e,i){let{match:n,bindingToken:r,groupToken:o,name:s}=t,a=Number(o);if(r==="auto"){let u=Po(a,e);return It(a,u,s),se(e,a,u,`application binding "${s}"`),n.replace(/@binding\(\s*auto\s*\)/,`@binding(${u})`)}return i.sawSupportedBindingDeclaration=!0,n}function Bo(t,e,i,n){let r=new Map;if(!e)return r;for(let o of t)for(let s of To(o,n)){let a=tn(s.group,o.name,s.name),u=e.get(a);if(u!==void 0){let f=r.get(s.group)||new Map,l=f.get(u);if(l&&l!==a)throw new Error(`Duplicate WGSL binding reservation for modules "${l}" and "${a}": group ${s.group}, binding ${u}.`);se(i,s.group,u,`registered module binding "${a}"`),f.set(u,a),r.set(s.group,f)}}return r}function Io(t,e,i,n){let r=t.get(e);if(!r)return!1;let o=r.get(i);if(!o)return!1;if(o!==n)throw new Error(`Registered module binding "${n}" collided with "${o}": group ${e}, binding ${i}.`);return!0}function To(t,e){let i=[],n=Y(t.source||"",{defines:e});for(let r of Z(n,ne))i.push({name:r.name,group:Number(r.groupToken)});return i}function It(t,e,i){if(t===0&&e>=Se)throw new Error(`Application binding "${i}" in group 0 uses reserved binding ${e}. Application-owned explicit group-0 bindings must stay below ${Se}.`)}function Xi(t,e,i,n){if(e===0&&i<Se)throw new Error(`Module "${t}" binding "${n}" in group 0 uses reserved application binding ${i}. Module-owned explicit group-0 bindings must be ${Se} or higher.`)}function se(t,e,i,n){let r=t.get(e)||new Set;if(r.has(i))throw new Error(`Duplicate WGSL binding assignment for ${n}: group ${e}, binding ${i}.`);r.add(i),t.set(e,r)}function Oo(t,e,i,n,r){let o=e.get(t)||new Set,s=new Set,a=`${t}:`,u=`${a}${i}:`;for(let[l,d]of r||[])l.startsWith(u)&&s.add(d);let f=n??(t===0?Se:o.size>0?Math.max(...o)+1:0);for(;o.has(f)||s.has(f);)f++;for(let[l,d]of r||[])d===f&&l.startsWith(a)&&r?.delete(l);return f}function Po(t,e){let i=e.get(t)||new Set,n=0;for(;i.has(n);)n++;return n}function Co(t){let e=hi(t,ne);if(!e)return;let i=Ro(t,e.index);throw i?new Error(`Unresolved @binding(auto) for module "${i}" binding "${e.name}" remained in assembled WGSL source.`):Do(t,e.index)?new Error(`Unresolved @binding(auto) for application binding "${e.name}" remained in assembled WGSL source.`):new Error(`Unresolved @binding(auto) remained in assembled WGSL source near "${Fo(e.match)}".`)}function No(t){if(t.length===0)return"";let e=`// ----- MODULE WGSL BINDING ASSIGNMENTS ---------------
`;for(let i of t)e+=`// ${i.moduleName}.${i.name} -> @group(${i.group}) @binding(${i.location})
`;return e+=`
`,e}function tn(t,e,i){return`${t}:${e}:${i}`}function Ro(t,e){let i=/^\/\/ ----- MODULE ([^\n]+) ---------------$/gm,n,r;for(r=i.exec(t);r&&r.index<=e;)n=r[1],r=i.exec(t);return n}function Do(t,e){let i=t.indexOf(Bt);return i>=0?e>i:!0}function Fo(t){return t.replace(/\s+/g," ").trim()}var F=class t{static defaultShaderAssemblers={};_hookFunctions=[];_defaultModules=[];static getDefaultShaderAssembler(e){return $(e==="glsl"||e==="wgsl"),e==="wgsl"?(t.defaultShaderAssemblers.wgsl=t.defaultShaderAssemblers.wgsl||new ae,t.defaultShaderAssemblers.wgsl):(t.defaultShaderAssemblers.glsl=t.defaultShaderAssemblers.glsl||new qe,t.defaultShaderAssemblers.glsl)}addDefaultModule(e){this._defaultModules.find(i=>i.name===(typeof e=="string"?e:e.name))||this._defaultModules.push(e)}removeDefaultModule(e){let i=typeof e=="string"?e:e.name;this._defaultModules=this._defaultModules.filter(n=>n.name!==i)}addShaderHook(e,i){i&&(e=Object.assign(i,{hook:e})),this._hookFunctions.push(e)}_getModuleList(e=[]){let i=new Array(this._defaultModules.length+e.length),n={},r=0;for(let o=0,s=this._defaultModules.length;o<s;++o){let a=this._defaultModules[o],u=a.name;i[r++]=a,n[u]=!0}for(let o=0,s=e.length;o<s;++o){let a=e[o],u=a.name;n[u]||(i[r++]=a,n[u]=!0)}return i.length=r,oe(i),i}},qe=class extends F{shaderLanguage="glsl";assembleGLSLShaderPair(e){let i=this._getModuleList(e.modules),n=this._hookFunctions;return{...Yi({...e,vs:e.vs,fs:e.fs,modules:i,hookFunctions:n}),modules:i}}},ae=class t extends F{shaderLanguage="wgsl";_wgslBindingRegistry=new Map;assembleWGSLShader(e){let i=this._getModuleList(e.modules),n=this._hookFunctions,r=t.getShaderPreprocessorDefines(e,i),o=e.platformInfo.shaderLanguage==="wgsl"&&e.source?Y(e.source,{defines:r}):e.source,{source:s,getUniforms:a,bindingAssignments:u}=Ki({...e,source:o,defines:r,_bindingRegistry:this._wgslBindingRegistry,modules:i,hookFunctions:n}),f=e.platformInfo.shaderLanguage==="wgsl"?Y(s,{defines:r}):s;return{source:f,getUniforms:a,modules:i,bindingAssignments:u,bindingTable:ke(f,u),shaderLayout:Me(f,{vertexEntryPoint:e.vertexEntryPoint,scanVertexAttributes:e.scanVertexAttributes})}}static getShaderPreprocessorDefines(e,i){return{...t.getPlatformPreprocessorDefines(e.platformInfo),...i.reduce((n,r)=>(Object.assign(n,r.defines),n),{}),...e.defines}}static getPlatformPreprocessorDefines(e){let i=e.limits||{};return{LUMA_SUPPORTS_VERTEX_STORAGE_BUFFERS:e.type==="webgpu"&&(i.maxStorageBuffersInVertexStage||0)>0,LUMA_FP32_TAN_PRECISION_WORKAROUND:e.type==="webgpu"&&e.gpu.toLowerCase()!=="nvidia"&&e.gpu.toLowerCase()!=="amd",LUMA_FP64_INTEGER_ARITHMETIC:e.type==="webgpu"&&e.gpu.toLowerCase()==="apple"}}};var Mo=`out vec4 transform_output;
void main() {
  transform_output = vec4(0);
}`,Go=`#version 300 es
${Mo}`;function Ee(t){let{input:e,inputChannels:i,output:n}=t||{};if(!e)return Go;if(!i)throw new Error("inputChannels");let r=Uo(i),o=nn(e,i);return`#version 300 es
in ${r} ${e};
out vec4 ${n};
void main() {
  ${n} = ${o};
}`}function Uo(t){switch(t){case 1:return"float";case 2:return"vec2";case 3:return"vec3";case 4:return"vec4";default:throw new Error(`invalid channels: ${t}`)}}function nn(t,e){switch(e){case 1:return`vec4(${t}, 0.0, 0.0, 1.0)`;case 2:return`vec4(${t}, 0.0, 1.0)`;case 3:return`vec4(${t}, 1.0)`;case 4:return t;default:throw new Error(`invalid channels: ${e}`)}}function Tt(t,e=[],i=0){let n=Math.fround(t),r=t-n;return e[i]=n,e[i+1]=r,e}function rn(t){return t-Math.fround(t)}function on(t){let e=new Float32Array(32);for(let i=0;i<4;++i)for(let n=0;n<4;++n){let r=i*4+n;Tt(t[n*4+i],e,r*2)}return e}function Ze(t,e=!0){return t??e}function Ot(t=[0,0,0],e=!0){return e?t.map(i=>i/255):[...t]}function sn(t,e=!0){let i=Ot(t.slice(0,3),e),n=Number.isFinite(t[3]),r=n?t[3]:1;return[i[0],i[1],i[2],e&&n?r/255:r]}var Pt=`
layout(std140) uniform fp64arithmeticUniforms {
  uniform float ONE;
  uniform float SPLIT;
} fp64;

/*
About LUMA_FP64_CODE_ELIMINATION_WORKAROUND

The purpose of this workaround is to prevent shader compilers from
optimizing away necessary arithmetic operations by swapping their sequences
or transform the equation to some 'equivalent' form.

These helpers implement Dekker/Veltkamp-style error tracking. If the compiler
folds constants or reassociates the arithmetic, the high/low split can stop
tracking the rounding error correctly. That failure mode tends to look fine in
simple coordinate setup, but then breaks down inside iterative arithmetic such
as fp64 Mandelbrot loops.

The method is to multiply an artifical variable, ONE, which will be known to
the compiler to be 1 only at runtime. The whole expression is then represented
as a polynomial with respective to ONE. In the coefficients of all terms, only one a
and one b should appear

err = (a + b) * ONE^6 - a * ONE^5 - (a + b) * ONE^4 + a * ONE^3 - b - (a + b) * ONE^2 + a * ONE
*/

float prevent_fp64_optimization(float value) {
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  return value + fp64.ONE * 0.0;
#else
  return value;
#endif
}

// Divide float number to high and low floats to extend fraction bits
vec2 split(float a) {
  // Keep SPLIT as a runtime uniform so the compiler cannot fold the Dekker
  // split into a constant expression and reassociate the recovery steps.
  float split = prevent_fp64_optimization(fp64.SPLIT);
  float t = prevent_fp64_optimization(a * split);
  float temp = t - a;
  float a_hi = t - temp;
  float a_lo = a - a_hi;
  return vec2(a_hi, a_lo);
}

// Divide float number again when high float uses too many fraction bits
vec2 split2(vec2 a) {
  vec2 b = split(a.x);
  b.y += a.y;
  return b;
}

// Special sum operation when a > b
vec2 quickTwoSum(float a, float b) {
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  float sum = (a + b) * fp64.ONE;
  float err = b - (sum - a) * fp64.ONE;
#else
  float sum = a + b;
  float err = b - (sum - a);
#endif
  return vec2(sum, err);
}

// General sum operation
vec2 twoSum(float a, float b) {
  float s = (a + b);
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  float v = (s * fp64.ONE - a) * fp64.ONE;
  float err = (a - (s - v) * fp64.ONE) * fp64.ONE * fp64.ONE * fp64.ONE + (b - v);
#else
  float v = s - a;
  float err = (a - (s - v)) + (b - v);
#endif
  return vec2(s, err);
}

vec2 twoSub(float a, float b) {
  float s = (a - b);
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  float v = (s * fp64.ONE - a) * fp64.ONE;
  float err = (a - (s - v) * fp64.ONE) * fp64.ONE * fp64.ONE * fp64.ONE - (b + v);
#else
  float v = s - a;
  float err = (a - (s - v)) - (b + v);
#endif
  return vec2(s, err);
}

vec2 twoSqr(float a) {
  float prod = a * a;
  vec2 a_fp64 = split(a);
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  float err = ((a_fp64.x * a_fp64.x - prod) * fp64.ONE + 2.0 * a_fp64.x *
    a_fp64.y * fp64.ONE * fp64.ONE) + a_fp64.y * a_fp64.y * fp64.ONE * fp64.ONE * fp64.ONE;
#else
  float err = ((a_fp64.x * a_fp64.x - prod) + 2.0 * a_fp64.x * a_fp64.y) + a_fp64.y * a_fp64.y;
#endif
  return vec2(prod, err);
}

vec2 twoProd(float a, float b) {
  float prod = a * b;
  vec2 a_fp64 = split(a);
  vec2 b_fp64 = split(b);
  // twoProd is especially sensitive because mul_fp64 and div_fp64 both depend
  // on the split terms and cross terms staying in the original evaluation
  // order. If the compiler folds or reassociates them, the low part tends to
  // collapse to zero or NaN on some drivers.
  float highProduct = prevent_fp64_optimization(a_fp64.x * b_fp64.x);
  float crossProduct1 = prevent_fp64_optimization(a_fp64.x * b_fp64.y);
  float crossProduct2 = prevent_fp64_optimization(a_fp64.y * b_fp64.x);
  float lowProduct = prevent_fp64_optimization(a_fp64.y * b_fp64.y);
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  float err1 = (highProduct - prod) * fp64.ONE;
  float err2 = crossProduct1 * fp64.ONE * fp64.ONE;
  float err3 = crossProduct2 * fp64.ONE * fp64.ONE * fp64.ONE;
  float err4 = lowProduct * fp64.ONE * fp64.ONE * fp64.ONE * fp64.ONE;
#else
  float err1 = highProduct - prod;
  float err2 = crossProduct1;
  float err3 = crossProduct2;
  float err4 = lowProduct;
#endif
  float err = ((err1 + err2) + err3) + err4;
  return vec2(prod, err);
}

vec2 sum_fp64(vec2 a, vec2 b) {
  vec2 s, t;
  s = twoSum(a.x, b.x);
  t = twoSum(a.y, b.y);
  s.y += t.x;
  s = quickTwoSum(s.x, s.y);
  s.y += t.y;
  s = quickTwoSum(s.x, s.y);
  return s;
}

vec2 sub_fp64(vec2 a, vec2 b) {
  vec2 s, t;
  s = twoSub(a.x, b.x);
  t = twoSub(a.y, b.y);
  s.y += t.x;
  s = quickTwoSum(s.x, s.y);
  s.y += t.y;
  s = quickTwoSum(s.x, s.y);
  return s;
}

vec2 mul_fp64(vec2 a, vec2 b) {
  vec2 prod = twoProd(a.x, b.x);
  // y component is for the error
  prod.y += a.x * b.y;
#if defined(LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND)
  prod = split2(prod);
#endif
  prod = quickTwoSum(prod.x, prod.y);
  prod.y += a.y * b.x;
#if defined(LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND)
  prod = split2(prod);
#endif
  prod = quickTwoSum(prod.x, prod.y);
  return prod;
}

vec2 div_fp64(vec2 a, vec2 b) {
  float xn = 1.0 / b.x;
#if defined(LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND)
  vec2 yn = mul_fp64(a, vec2(xn, 0));
#else
  vec2 yn = a * xn;
#endif
  float diff = (sub_fp64(a, mul_fp64(b, yn))).x;
  vec2 prod = twoProd(xn, diff);
  return sum_fp64(yn, prod);
}

vec2 sqrt_fp64(vec2 a) {
  if (a.x == 0.0 && a.y == 0.0) return vec2(0.0, 0.0);
  if (a.x < 0.0) return vec2(0.0 / 0.0, 0.0 / 0.0);

  float x = 1.0 / sqrt(a.x);
  float yn = a.x * x;
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  vec2 yn_sqr = twoSqr(yn) * fp64.ONE;
#else
  vec2 yn_sqr = twoSqr(yn);
#endif
  float diff = sub_fp64(a, yn_sqr).x;
  vec2 prod = twoProd(x * 0.5, diff);
#if defined(LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND)
  return sum_fp64(split(yn), prod);
#else
  return sum_fp64(vec2(yn, 0.0), prod);
#endif
}
`;var an=`struct Fp64F32Bits {
  sign: u32,
  baseExponent: i32,
  significand: u32,
  isZero: bool,
  isInf: bool,
  isNan: bool,
};

// Decode an f32 as (-1)^sign * significand * 2^baseExponent.
fn fp64_decode_f32_bits(bits: u32) -> Fp64F32Bits {
  let sign = bits >> 31u;
  let exponentBits = (bits >> 23u) & 0xffu;
  let fraction = bits & 0x7fffffu;

  if (exponentBits == 0xffu) {
    return Fp64F32Bits(sign, 0, 0u, false, fraction == 0u, fraction != 0u);
  }
  if (exponentBits == 0u) {
    return Fp64F32Bits(sign, -149, fraction, fraction == 0u, false, false);
  }
  return Fp64F32Bits(sign, i32(exponentBits) - 150, 0x800000u | fraction, false, false, false);
}

fn fp64_f32_magnitude_compare(aBits: u32, bBits: u32) -> i32 {
  let aMagnitude = aBits & 0x7fffffffu;
  let bMagnitude = bBits & 0x7fffffffu;
  if (aMagnitude == bMagnitude) {
    return 0;
  }
  return select(-1, 1, aMagnitude > bMagnitude);
}

fn fp64_make_residual_f32_bits(
  exactSign: u32,
  exactMagnitude: vec2u,
  exactBaseExponent: i32,
  highBits: u32
) -> u32 {
  if (fp64_u64_is_zero(exactMagnitude)) {
    return 0u;
  }

  let high = fp64_decode_f32_bits(highBits);
  if (high.isInf || high.isNan) {
    return exactSign << 31u;
  }
  if (high.isZero) {
    return fp64_make_f32_bits_from_u64(exactSign, exactMagnitude, exactBaseExponent);
  }

  let commonBaseExponent = min(exactBaseExponent, high.baseExponent);
  let exactShift = exactBaseExponent - commonBaseExponent;
  let highShift = high.baseExponent - commonBaseExponent;

  // A normal two-sum/two-product residual never needs a shift this large.
  // This guard gives deterministic underflow behavior outside that contract.
  if (exactShift >= 64 || highShift >= 64) {
    return exactSign << 31u;
  }

  let exactAligned = fp64_u64_shift_left(exactMagnitude, u32(exactShift));
  let highAligned = fp64_u64_shift_left(vec2u(0u, high.significand), u32(highShift));
  let comparison = fp64_u64_compare(exactAligned, highAligned);
  if (comparison == 0) {
    return 0u;
  }

  var residualSign = exactSign;
  var residualMagnitude: vec2u;
  if (comparison > 0) {
    residualMagnitude = fp64_u64_sub(exactAligned, highAligned);
  } else {
    residualSign = exactSign ^ 1u;
    residualMagnitude = fp64_u64_sub(highAligned, exactAligned);
  }
  return fp64_make_f32_bits_from_u64(
    residualSign,
    residualMagnitude,
    commonBaseExponent
  );
}

fn fp64_split_accumulator_bits(
  sign: u32,
  magnitude: vec2u,
  baseExponent: i32
) -> vec2u {
  let highBits = fp64_make_f32_bits_from_u64(sign, magnitude, baseExponent);
  let lowBits = fp64_make_residual_f32_bits(sign, magnitude, baseExponent, highBits);
  return vec2u(highBits, lowBits);
}

fn fp64_two_sum_integer_bits(aBits: u32, bBits: u32) -> vec2u {
  let a = fp64_decode_f32_bits(aBits);
  let b = fp64_decode_f32_bits(bBits);

  if (a.isNan || b.isNan) {
    return vec2u(0x7fc00000u, 0u);
  }
  if (a.isInf || b.isInf) {
    if (a.isInf && b.isInf && a.sign != b.sign) {
      return vec2u(0x7fc00000u, 0u);
    }
    return select(vec2u(bBits, 0u), vec2u(aBits, 0u), a.isInf);
  }
  if (a.isZero && b.isZero) {
    return vec2u((a.sign & b.sign) << 31u, 0u);
  }
  if (a.isZero) {
    return vec2u(bBits, 0u);
  }
  if (b.isZero) {
    return vec2u(aBits, 0u);
  }

  let exponentDifference = select(
    b.baseExponent - a.baseExponent,
    a.baseExponent - b.baseExponent,
    a.baseExponent >= b.baseExponent
  );

  // Beyond half an ulp, rounding cannot change the larger operand. Returning
  // the smaller operand intact also avoids an unbounded integer alignment.
  // At a power-of-two boundary the spacing below the larger operand is half
  // the spacing above it, so an opposite-sign gap-25 operand can still change
  // the rounded high limb. Gap 26 is the first universally safe early-out.
  if (exponentDifference > 25) {
    if (fp64_f32_magnitude_compare(aBits, bBits) >= 0) {
      return vec2u(aBits, bBits);
    }
    return vec2u(bBits, aBits);
  }

  let commonBaseExponent = min(a.baseExponent, b.baseExponent);
  let aMagnitude = fp64_u64_shift_left(
    vec2u(0u, a.significand),
    u32(a.baseExponent - commonBaseExponent)
  );
  let bMagnitude = fp64_u64_shift_left(
    vec2u(0u, b.significand),
    u32(b.baseExponent - commonBaseExponent)
  );

  var resultSign = a.sign;
  var resultMagnitude: vec2u;
  if (a.sign == b.sign) {
    resultMagnitude = fp64_u64_add(aMagnitude, bMagnitude);
  } else {
    let comparison = fp64_u64_compare(aMagnitude, bMagnitude);
    if (comparison == 0) {
      return vec2u(0u, 0u);
    }
    if (comparison > 0) {
      resultMagnitude = fp64_u64_sub(aMagnitude, bMagnitude);
    } else {
      resultSign = b.sign;
      resultMagnitude = fp64_u64_sub(bMagnitude, aMagnitude);
    }
  }

  return fp64_split_accumulator_bits(resultSign, resultMagnitude, commonBaseExponent);
}

fn fp64_two_sum_integer(a: f32, b: f32) -> vec2f {
  let resultBits = fp64_two_sum_integer_bits(bitcast<u32>(a), bitcast<u32>(b));
  return vec2f(bitcast<f32>(resultBits.x), bitcast<f32>(resultBits.y));
}

fn fp64_multiply_significands(a: u32, b: u32) -> vec2u {
  let aLow = a & 0xffffu;
  let aHigh = a >> 16u;
  let bLow = b & 0xffffu;
  let bHigh = b >> 16u;
  let lowProduct = aLow * bLow;
  let crossProduct = aLow * bHigh + aHigh * bLow;
  let highProduct = aHigh * bHigh;

  var result = vec2u(0u, lowProduct);
  result = fp64_u64_add(
    result,
    fp64_u64_shift_left(vec2u(0u, crossProduct), 16u)
  );
  result = fp64_u64_add(result, vec2u(highProduct, 0u));
  return result;
}

fn fp64_two_prod_integer_bits(aBits: u32, bBits: u32) -> vec2u {
  let a = fp64_decode_f32_bits(aBits);
  let b = fp64_decode_f32_bits(bBits);
  let resultSign = a.sign ^ b.sign;

  if (a.isNan || b.isNan || ((a.isZero || b.isZero) && (a.isInf || b.isInf))) {
    return vec2u(0x7fc00000u, 0u);
  }
  if (a.isInf || b.isInf) {
    return vec2u((resultSign << 31u) | 0x7f800000u, resultSign << 31u);
  }
  if (a.isZero || b.isZero) {
    return vec2u(resultSign << 31u, resultSign << 31u);
  }

  let magnitude = fp64_multiply_significands(a.significand, b.significand);
  return fp64_split_accumulator_bits(
    resultSign,
    magnitude,
    a.baseExponent + b.baseExponent
  );
}

fn fp64_two_prod_integer(a: f32, b: f32) -> vec2f {
  let resultBits = fp64_two_prod_integer_bits(bitcast<u32>(a), bitcast<u32>(b));
  return vec2f(bitcast<f32>(resultBits.x), bitcast<f32>(resultBits.y));
}

fn fp64_round_add_integer(a: f32, b: f32) -> f32 {
  return fp64_two_sum_integer(a, b).x;
}

fn fp64_round_mul_integer(a: f32, b: f32) -> f32 {
  return fp64_two_prod_integer(a, b).x;
}

#ifndef LUMA_FP64_PREDICATE_ONLY
fn fp64_f32_finite_exponent(value: Fp64F32Bits) -> i32 {
  let mostSignificantBit = 31u - countLeadingZeros(value.significand);
  return value.baseExponent + i32(mostSignificantBit);
}

fn fp64_scale_f32_integer(value: f32, exponent: i32) -> f32 {
  let decoded = fp64_decode_f32_bits(bitcast<u32>(value));
  if (decoded.isZero || decoded.isInf || decoded.isNan) {
    return value;
  }
  let resultBits = fp64_make_f32_bits_from_u64(
    decoded.sign,
    vec2u(0u, decoded.significand),
    decoded.baseExponent + exponent
  );
  return bitcast<f32>(resultBits);
}

// Divide normalized significands so the hardware operation cannot overflow,
// underflow, or flush a subnormal result. Reapply the exponent with integer
// packing, which also produces subnormal correction limbs without relying on
// floating-point arithmetic to preserve them.
fn fp64_divide_f32_integer(aValue: f32, bValue: f32) -> f32 {
  let a = fp64_decode_f32_bits(bitcast<u32>(aValue));
  let b = fp64_decode_f32_bits(bitcast<u32>(bValue));
  if (a.isZero || b.isZero || a.isInf || b.isInf || a.isNan || b.isNan) {
    return aValue / bValue;
  }

  let aMostSignificantBit = 31u - countLeadingZeros(a.significand);
  let bMostSignificantBit = 31u - countLeadingZeros(b.significand);
  let normalizedABits = fp64_make_f32_bits_from_u64(
    a.sign,
    vec2u(0u, a.significand),
    -i32(aMostSignificantBit)
  );
  let normalizedBBits = fp64_make_f32_bits_from_u64(
    b.sign,
    vec2u(0u, b.significand),
    -i32(bMostSignificantBit)
  );
  let normalizedQuotient = bitcast<f32>(normalizedABits) / bitcast<f32>(normalizedBBits);
  let quotient = fp64_decode_f32_bits(bitcast<u32>(normalizedQuotient));
  let exponentShift =
    a.baseExponent + i32(aMostSignificantBit) -
    b.baseExponent - i32(bMostSignificantBit);
  let quotientBits = fp64_make_f32_bits_from_u64(
    quotient.sign,
    vec2u(0u, quotient.significand),
    quotient.baseExponent + exponentShift
  );
  return bitcast<f32>(quotientBits);
}
#endif

#ifndef LUMA_FP64_PREDICATE_ONLY
fn split(a: f32) -> vec2f {
  let aBits = bitcast<u32>(a);
  let decoded = fp64_decode_f32_bits(aBits);
  if (decoded.isZero || decoded.isInf || decoded.isNan) {
    return vec2f(a, 0.0);
  }

  var roundedHigh = decoded.significand >> 12u;
  let remainder = decoded.significand & 0xfffu;
  if (remainder > 0x800u || (remainder == 0x800u && (roundedHigh & 1u) == 1u)) {
    roundedHigh = roundedHigh + 1u;
  }
  var highMagnitude = vec2u(0u, roundedHigh << 12u);
  var highBits = fp64_make_f32_bits_from_u64(
    decoded.sign,
    highMagnitude,
    decoded.baseExponent
  );
  // Rounding the high limb of a maximum-exponent value can overflow even
  // though the original value is finite. Truncate only in that boundary case
  // so split remains an exact finite decomposition.
  if (fp64_decode_f32_bits(highBits).isInf) {
    roundedHigh = decoded.significand >> 12u;
    highMagnitude = vec2u(0u, roundedHigh << 12u);
    highBits = fp64_make_f32_bits_from_u64(
      decoded.sign,
      highMagnitude,
      decoded.baseExponent
    );
  }
  let lowBits = fp64_make_residual_f32_bits(
    decoded.sign,
    vec2u(0u, decoded.significand),
    decoded.baseExponent,
    highBits
  );
  return vec2f(bitcast<f32>(highBits), bitcast<f32>(lowBits));
}

fn split2(a: vec2f) -> vec2f {
  var result = split(a.x);
  result.y = fp64_round_add_integer(result.y, a.y);
  return result;
}
#endif

#ifndef LUMA_FP64_PREDICATE_ONLY
fn quickTwoSum(a: f32, b: f32) -> vec2f {
  return fp64_two_sum_integer(a, b);
}
#endif

fn twoSum(a: f32, b: f32) -> vec2f {
  return fp64_two_sum_integer(a, b);
}

fn twoSub(a: f32, b: f32) -> vec2f {
  let bBits = bitcast<u32>(b) ^ 0x80000000u;
  let resultBits = fp64_two_sum_integer_bits(bitcast<u32>(a), bBits);
  return vec2f(bitcast<f32>(resultBits.x), bitcast<f32>(resultBits.y));
}

#ifndef LUMA_FP64_PREDICATE_ONLY
fn twoSqr(a: f32) -> vec2f {
  return fp64_two_prod_integer(a, a);
}

fn twoProd(a: f32, b: f32) -> vec2f {
  return fp64_two_prod_integer(a, b);
}
#endif

fn sum_fp64(a: vec2f, b: vec2f) -> vec2f {
  var sum = fp64_two_sum_integer(a.x, b.x);
  let lowSum = fp64_two_sum_integer(a.y, b.y);
  sum.y = fp64_round_add_integer(sum.y, lowSum.x);
  sum = fp64_two_sum_integer(sum.x, sum.y);
  sum.y = fp64_round_add_integer(sum.y, lowSum.y);
  return fp64_two_sum_integer(sum.x, sum.y);
}

fn sub_fp64(a: vec2f, b: vec2f) -> vec2f {
  let negatedB = vec2f(
    bitcast<f32>(bitcast<u32>(b.x) ^ 0x80000000u),
    bitcast<f32>(bitcast<u32>(b.y) ^ 0x80000000u)
  );
  return sum_fp64(a, negatedB);
}

fn mul_fp64(a: vec2f, b: vec2f) -> vec2f {
  var product = fp64_two_prod_integer(a.x, b.x);
  let crossProduct1 = fp64_round_mul_integer(a.x, b.y);
  product.y = fp64_round_add_integer(product.y, crossProduct1);
  product = fp64_two_sum_integer(product.x, product.y);
  let crossProduct2 = fp64_round_mul_integer(a.y, b.x);
  product.y = fp64_round_add_integer(product.y, crossProduct2);
  return fp64_two_sum_integer(product.x, product.y);
}

#ifndef LUMA_FP64_PREDICATE_ONLY
fn fp64_scale_fp64_integer(value: vec2f, exponent: i32) -> vec2f {
  let high = fp64_scale_f32_integer(value.x, exponent);
  let low = fp64_scale_f32_integer(value.y, exponent);
  return sum_fp64(vec2f(high, 0.0), vec2f(low, 0.0));
}

fn fp64_div_fp64_normalized(a: vec2f, b: vec2f) -> vec2f {
  let quotientHigh = fp64_divide_f32_integer(a.x, b.x);
  var quotient = vec2f(quotientHigh, 0.0);

  let remainder = sub_fp64(a, mul_fp64(b, quotient));
  let quotientLow = fp64_divide_f32_integer(remainder.x, b.x);
  quotient = sum_fp64(quotient, vec2f(quotientLow, 0.0));

  let secondRemainder = sub_fp64(a, mul_fp64(b, quotient));
  let correction = fp64_divide_f32_integer(secondRemainder.x, b.x);
  return sum_fp64(quotient, vec2f(correction, 0.0));
}

fn div_fp64(a: vec2f, b: vec2f) -> vec2f {
  let decodedA = fp64_decode_f32_bits(bitcast<u32>(a.x));
  let decodedB = fp64_decode_f32_bits(bitcast<u32>(b.x));
  if (
    decodedA.isZero || decodedB.isZero ||
    decodedA.isInf || decodedB.isInf ||
    decodedA.isNan || decodedB.isNan
  ) {
    return fp64_div_fp64_normalized(a, b);
  }

  let exponentA = fp64_f32_finite_exponent(decodedA);
  let exponentB = fp64_f32_finite_exponent(decodedB);
  // Correct the quotient near unity so b * q and the remainder stay clear of
  // both f32 underflow and overflow. The exponent difference is applied once.
  let normalizedA = fp64_scale_fp64_integer(a, -exponentA);
  let normalizedB = fp64_scale_fp64_integer(b, -exponentB);
  let normalizedQuotient = fp64_div_fp64_normalized(normalizedA, normalizedB);
  return fp64_scale_fp64_integer(normalizedQuotient, exponentA - exponentB);
}

fn fp64_sqrt_fp64_normalized(a: vec2f) -> vec2f {
  let estimate = sqrt(a.x);
  let difference = sub_fp64(a, fp64_two_prod_integer(estimate, estimate)).x;
  let denominator = fp64_round_add_integer(estimate, estimate);
  let correction = fp64_divide_f32_integer(difference, denominator);
  return sum_fp64(vec2f(estimate, 0.0), vec2f(correction, 0.0));
}

fn sqrt_fp64(a: vec2f) -> vec2f {
  let decoded = fp64_decode_f32_bits(bitcast<u32>(a.x));
  let decodedLow = fp64_decode_f32_bits(bitcast<u32>(a.y));
  if (decoded.isZero && decodedLow.isZero) {
    return vec2f(0.0, 0.0);
  }
  if (decoded.sign == 1u) {
    let nanValue = fp64_nan(a.x);
    return vec2f(nanValue, nanValue);
  }

  if (decoded.isInf || decoded.isNan) {
    return fp64_sqrt_fp64_normalized(a);
  }
  let exponent = fp64_f32_finite_exponent(decoded);
  // An even scale lets the final square-root rescale use an integer exponent.
  let evenExponent = exponent - (exponent & 1);
  let normalizedA = fp64_scale_fp64_integer(a, -evenExponent);
  let normalizedRoot = fp64_sqrt_fp64_normalized(normalizedA);
  return fp64_scale_fp64_integer(normalizedRoot, evenExponent / 2);
}
#endif
`;var un=`struct Fp64ArithmeticUniforms {
  ONE: f32,
  SPLIT: f32,
};

@group(0) @binding(auto) var<uniform> fp64arithmetic : Fp64ArithmeticUniforms;

#ifndef LUMA_FP64_F32_INPUT_ONLY
struct Fp64Bits {
  sign: u32,
  exponent: i32,
  significand: vec2u,
  isZero: bool,
  isInf: bool,
  isNan: bool,
};
#endif

#ifndef LUMA_FP64_PREDICATE_ONLY
fn fp64_nan(seed: f32) -> f32 {
  let nanBits = 0x7fc00000u | select(0u, 1u, seed < 0.0);
  return bitcast<f32>(nanBits);
}
#endif

fn fp64_u64_is_zero(value: vec2u) -> bool {
  return value.x == 0u && value.y == 0u;
}

fn fp64_u64_compare(a: vec2u, b: vec2u) -> i32 {
  if (a.x != b.x) {
    return select(-1, 1, a.x > b.x);
  }
  if (a.y != b.y) {
    return select(-1, 1, a.y > b.y);
  }
  return 0;
}

fn fp64_u64_add(a: vec2u, b: vec2u) -> vec2u {
  let low = a.y + b.y;
  let carry = select(0u, 1u, low < a.y);
  return vec2u(a.x + b.x + carry, low);
}

fn fp64_u64_sub(a: vec2u, b: vec2u) -> vec2u {
  let borrow = select(0u, 1u, a.y < b.y);
  return vec2u(a.x - b.x - borrow, a.y - b.y);
}

fn fp64_u64_shift_left(value: vec2u, shift: u32) -> vec2u {
  if (shift == 0u) {
    return value;
  }
  if (shift < 32u) {
    return vec2u((value.x << shift) | (value.y >> (32u - shift)), value.y << shift);
  }
  if (shift == 32u) {
    return vec2u(value.y, 0u);
  }
  if (shift < 64u) {
    return vec2u(value.y << (shift - 32u), 0u);
  }
  return vec2u(0u);
}

fn fp64_u64_shift_right(value: vec2u, shift: u32) -> vec2u {
  if (shift == 0u) {
    return value;
  }
  if (shift < 32u) {
    return vec2u(value.x >> shift, (value.y >> shift) | (value.x << (32u - shift)));
  }
  if (shift == 32u) {
    return vec2u(0u, value.x);
  }
  if (shift < 64u) {
    return vec2u(0u, value.x >> (shift - 32u));
  }
  return vec2u(0u);
}

fn fp64_u64_get_bit(value: vec2u, bitIndex: u32) -> bool {
  if (bitIndex >= 64u) {
    return false;
  }
  if (bitIndex >= 32u) {
    return ((value.x >> (bitIndex - 32u)) & 1u) != 0u;
  }
  return ((value.y >> bitIndex) & 1u) != 0u;
}

fn fp64_u64_has_bits_below(value: vec2u, bitCount: u32) -> bool {
  if (bitCount == 0u) {
    return false;
  }
  if (bitCount >= 64u) {
    return !fp64_u64_is_zero(value);
  }
  if (bitCount > 32u) {
    let highBitCount = bitCount - 32u;
    let highMask = (1u << highBitCount) - 1u;
    return value.y != 0u || (value.x & highMask) != 0u;
  }
  if (bitCount == 32u) {
    return value.y != 0u;
  }
  let lowMask = (1u << bitCount) - 1u;
  return (value.y & lowMask) != 0u;
}

#ifndef LUMA_FP64_F32_INPUT_ONLY
fn fp64_u64_shift_right_sticky(value: vec2u, shift: u32) -> vec2u {
  var shifted = fp64_u64_shift_right(value, shift);
  if (fp64_u64_has_bits_below(value, shift)) {
    shifted.y = shifted.y | 1u;
  }
  return shifted;
}
#endif

fn fp64_u64_count_leading_zeros(value: vec2u) -> u32 {
  if (value.x != 0u) {
    return countLeadingZeros(value.x);
  }
  return 32u + countLeadingZeros(value.y);
}

fn fp64_round_shift_right_to_u32(value: vec2u, shift: u32) -> u32 {
  if (shift == 0u) {
    return value.y;
  }

  let truncated = fp64_u64_shift_right(value, shift);
  var rounded = truncated.y;
  let guard = fp64_u64_get_bit(value, shift - 1u);
  let hasTrailingBits = fp64_u64_has_bits_below(value, shift - 1u);
  if (guard && (hasTrailingBits || (rounded & 1u) == 1u)) {
    rounded = rounded + 1u;
  }
  return rounded;
}

#ifndef LUMA_FP64_F32_INPUT_ONLY
fn fp64_round_shift_right(value: vec2u, shift: u32) -> vec2u {
  if (shift == 0u) {
    return value;
  }

  var rounded = fp64_u64_shift_right(value, shift);
  let guard = fp64_u64_get_bit(value, shift - 1u);
  let hasTrailingBits = fp64_u64_has_bits_below(value, shift - 1u);
  if (guard && (hasTrailingBits || (rounded.y & 1u) == 1u)) {
    rounded = fp64_u64_add(rounded, vec2u(0u, 1u));
  }
  return rounded;
}
#endif

fn fp64_make_f32_bits_from_u64(sign: u32, significand: vec2u, baseExponent: i32) -> u32 {
  if (fp64_u64_is_zero(significand)) {
    return sign << 31u;
  }

  let leadingZeros = fp64_u64_count_leading_zeros(significand);
  let mostSignificantBit = 63u - leadingZeros;
  var exponent = baseExponent + i32(mostSignificantBit);

  if (exponent > 127) {
    return (sign << 31u) | 0x7f800000u;
  }

  if (exponent >= -126) {
    let shift = i32(mostSignificantBit) - 23;
    var significand24: u32;
    if (shift > 0) {
      significand24 = fp64_round_shift_right_to_u32(significand, u32(shift));
    } else {
      significand24 = fp64_u64_shift_left(significand, u32(-shift)).y;
    }

    if (significand24 >= 0x1000000u) {
      significand24 = significand24 >> 1u;
      exponent = exponent + 1;
      if (exponent > 127) {
        return (sign << 31u) | 0x7f800000u;
      }
    }

    return (sign << 31u) | (u32(exponent + 127) << 23u) | (significand24 & 0x7fffffu);
  }

  let scaleExponent = baseExponent + 149;
  var mantissa: u32;
  if (scaleExponent >= 0) {
    mantissa = fp64_u64_shift_left(significand, u32(scaleExponent)).y;
  } else {
    mantissa = fp64_round_shift_right_to_u32(significand, u32(-scaleExponent));
  }

  if (mantissa >= 0x800000u) {
    return (sign << 31u) | 0x00800000u;
  }
  return (sign << 31u) | mantissa;
}

#ifndef LUMA_FP64_F32_INPUT_ONLY
fn fp64_decode_bits(bits: vec2u) -> Fp64Bits {
  let sign = bits.x >> 31u;
  let exponentBits = (bits.x >> 20u) & 0x7ffu;
  let fractionHigh = bits.x & 0xfffffu;
  let fractionLow = bits.y;
  let fraction = vec2u(fractionHigh, fractionLow);

  if (exponentBits == 0x7ffu) {
    let isInf = fp64_u64_is_zero(fraction);
    return Fp64Bits(sign, 0, vec2u(0u), false, isInf, !isInf);
  }

  if (exponentBits == 0u) {
    let isZero = fp64_u64_is_zero(fraction);
    return Fp64Bits(sign, -1022, fraction, isZero, false, false);
  }

  return Fp64Bits(sign, i32(exponentBits) - 1023, vec2u((1u << 20u) | fractionHigh, fractionLow), false, false, false);
}

fn fp64_finite_magnitude_compare(a: Fp64Bits, b: Fp64Bits) -> i32 {
  if (a.exponent != b.exponent) {
    return select(-1, 1, a.exponent > b.exponent);
  }
  return fp64_u64_compare(a.significand, b.significand);
}
#endif

#ifndef LUMA_FP64_F32_INPUT_ONLY
struct Fp64RawF32Bits {
  sign: u32,
  baseExponent: i32,
  significand: u32,
  isZero: bool,
  isInf: bool,
  isNan: bool,
};

// Decode an f32 as (-1)^sign * significand * 2^baseExponent. This shared
// integer representation lets normalization remain independent of the
// selected double-single arithmetic implementation.
fn fp64_decode_raw_f32_bits(bits: u32) -> Fp64RawF32Bits {
  let sign = bits >> 31u;
  let exponentBits = (bits >> 23u) & 0xffu;
  let fraction = bits & 0x7fffffu;

  if (exponentBits == 0xffu) {
    return Fp64RawF32Bits(sign, 0, 0u, false, fraction == 0u, fraction != 0u);
  }
  if (exponentBits == 0u) {
    return Fp64RawF32Bits(sign, -149, fraction, fraction == 0u, false, false);
  }
  return Fp64RawF32Bits(
    sign,
    i32(exponentBits) - 150,
    0x800000u | fraction,
    false,
    false,
    false
  );
}

fn fp64_raw_f32_magnitude_compare(aBits: u32, bBits: u32) -> i32 {
  let aMagnitude = aBits & 0x7fffffffu;
  let bMagnitude = bBits & 0x7fffffffu;
  if (aMagnitude == bMagnitude) {
    return 0;
  }
  return select(-1, 1, aMagnitude > bMagnitude);
}

fn fp64_make_raw_residual_f32_bits(
  exactSign: u32,
  exactMagnitude: vec2u,
  exactBaseExponent: i32,
  highBits: u32
) -> u32 {
  if (fp64_u64_is_zero(exactMagnitude)) {
    return 0u;
  }

  let high = fp64_decode_raw_f32_bits(highBits);
  if (high.isInf || high.isNan) {
    return 0u;
  }
  if (high.isZero) {
    return fp64_make_f32_bits_from_u64(exactSign, exactMagnitude, exactBaseExponent);
  }

  let commonBaseExponent = min(exactBaseExponent, high.baseExponent);
  let exactShift = exactBaseExponent - commonBaseExponent;
  let highShift = high.baseExponent - commonBaseExponent;
  if (exactShift >= 64 || highShift >= 64) {
    return 0u;
  }

  let exactAligned = fp64_u64_shift_left(exactMagnitude, u32(exactShift));
  let highAligned = fp64_u64_shift_left(vec2u(0u, high.significand), u32(highShift));
  let comparison = fp64_u64_compare(exactAligned, highAligned);
  if (comparison == 0) {
    return 0u;
  }

  var residualSign = exactSign;
  var residualMagnitude: vec2u;
  if (comparison > 0) {
    residualMagnitude = fp64_u64_sub(exactAligned, highAligned);
  } else {
    residualSign = exactSign ^ 1u;
    residualMagnitude = fp64_u64_sub(highAligned, exactAligned);
  }
  return fp64_make_f32_bits_from_u64(
    residualSign,
    residualMagnitude,
    commonBaseExponent
  );
}

fn fp64_split_raw_accumulator_bits(
  sign: u32,
  magnitude: vec2u,
  baseExponent: i32
) -> vec2u {
  if (fp64_u64_is_zero(magnitude)) {
    return vec2u(0u);
  }
  let highBits = fp64_make_f32_bits_from_u64(sign, magnitude, baseExponent);
  let rawLowBits = fp64_make_raw_residual_f32_bits(sign, magnitude, baseExponent, highBits);
  let lowBits = select(rawLowBits, 0u, (rawLowBits & 0x7fffffffu) == 0u);
  if ((highBits & 0x7fffffffu) == 0u && (lowBits & 0x7fffffffu) == 0u) {
    return vec2u(0u);
  }
  return vec2u(highBits, lowBits);
}
#endif

#ifndef LUMA_FP64_F32_INPUT_ONLY
// Round an arithmetic accumulator to binary64 before splitting it. The
// aligned add/subtract paths retain three guard bits plus a sticky bit, which
// is sufficient for round-to-nearest-even at the binary64 boundary.
fn fp64_split_binary64_accumulator_bits(
  sign: u32,
  magnitude: vec2u,
  baseExponent: i32
) -> vec2u {
  if (fp64_u64_is_zero(magnitude)) {
    return vec2u(0u);
  }

  let mostSignificantBit = 63u - fp64_u64_count_leading_zeros(magnitude);
  let exponent = baseExponent + i32(mostSignificantBit);
  if (exponent > 1023) {
    return vec2u((sign << 31u) | 0x7f800000u, 0u);
  }

  var roundedMagnitude = magnitude;
  var roundedBaseExponent = baseExponent;
  if (exponent >= -1022) {
    if (mostSignificantBit > 52u) {
      let shift = mostSignificantBit - 52u;
      roundedMagnitude = fp64_round_shift_right(magnitude, shift);
      roundedBaseExponent = baseExponent + i32(shift);
    }
  } else {
    let shift = -1074 - baseExponent;
    if (shift > 0) {
      roundedMagnitude = fp64_round_shift_right(magnitude, u32(shift));
      roundedBaseExponent = -1074;
    }
  }

  if (fp64_u64_is_zero(roundedMagnitude)) {
    return vec2u(0u);
  }
  return fp64_split_raw_accumulator_bits(sign, roundedMagnitude, roundedBaseExponent);
}
#endif

#ifndef LUMA_FP64_PREDICATE_ONLY
fn fp64_add_raw_f32_bits(aBits: u32, bBits: u32) -> vec2u {
  let a = fp64_decode_raw_f32_bits(aBits);
  let b = fp64_decode_raw_f32_bits(bBits);

  if (a.isNan || b.isNan) {
    return vec2u(0x7fc00000u, 0u);
  }
  if (a.isInf || b.isInf) {
    if (a.isInf && b.isInf && a.sign != b.sign) {
      return vec2u(0x7fc00000u, 0u);
    }
    return select(vec2u(bBits, 0u), vec2u(aBits, 0u), a.isInf);
  }
  if (a.isZero && b.isZero) {
    return vec2u(0u);
  }
  if (a.isZero) {
    return vec2u(bBits, 0u);
  }
  if (b.isZero) {
    return vec2u(aBits, 0u);
  }

  let exponentDifference = abs(a.baseExponent - b.baseExponent);
  if (exponentDifference > 25) {
    if (fp64_raw_f32_magnitude_compare(aBits, bBits) >= 0) {
      return vec2u(aBits, bBits);
    }
    return vec2u(bBits, aBits);
  }

  let commonBaseExponent = min(a.baseExponent, b.baseExponent);
  let aMagnitude = fp64_u64_shift_left(
    vec2u(0u, a.significand),
    u32(a.baseExponent - commonBaseExponent)
  );
  let bMagnitude = fp64_u64_shift_left(
    vec2u(0u, b.significand),
    u32(b.baseExponent - commonBaseExponent)
  );

  var resultSign = a.sign;
  var resultMagnitude: vec2u;
  if (a.sign == b.sign) {
    resultMagnitude = fp64_u64_add(aMagnitude, bMagnitude);
  } else {
    let comparison = fp64_u64_compare(aMagnitude, bMagnitude);
    if (comparison == 0) {
      return vec2u(0u);
    }
    if (comparison > 0) {
      resultMagnitude = fp64_u64_sub(aMagnitude, bMagnitude);
    } else {
      resultSign = b.sign;
      resultMagnitude = fp64_u64_sub(bMagnitude, aMagnitude);
    }
  }

  return fp64_split_raw_accumulator_bits(
    resultSign,
    resultMagnitude,
    commonBaseExponent
  );
}
#endif

#ifndef LUMA_FP64_F32_INPUT_ONLY
fn fp64_add_aligned_magnitudes_to_fp64_bits(
  sign: u32,
  larger: Fp64Bits,
  smaller: Fp64Bits
) -> vec2u {
  let largeSignificand = fp64_u64_shift_left(larger.significand, 3u);
  let smallSignificand = fp64_u64_shift_right_sticky(
    fp64_u64_shift_left(smaller.significand, 3u),
    u32(larger.exponent - smaller.exponent)
  );
  let resultSignificand = fp64_u64_add(largeSignificand, smallSignificand);
  return fp64_split_binary64_accumulator_bits(
    sign,
    resultSignificand,
    larger.exponent - 55
  );
}

fn fp64_sub_aligned_magnitudes_to_fp64_bits(
  sign: u32,
  larger: Fp64Bits,
  smaller: Fp64Bits
) -> vec2u {
  let largeSignificand = fp64_u64_shift_left(larger.significand, 3u);
  let smallSignificand = fp64_u64_shift_right_sticky(
    fp64_u64_shift_left(smaller.significand, 3u),
    u32(larger.exponent - smaller.exponent)
  );
  let resultSignificand = fp64_u64_sub(largeSignificand, smallSignificand);
  return fp64_split_binary64_accumulator_bits(
    sign,
    resultSignificand,
    larger.exponent - 55
  );
}

fn fp64_add_aligned_magnitudes_to_f32_bits(sign: u32, larger: Fp64Bits, smaller: Fp64Bits) -> u32 {
  let largeSignificand = fp64_u64_shift_left(larger.significand, 3u);
  let smallSignificand = fp64_u64_shift_right_sticky(
    fp64_u64_shift_left(smaller.significand, 3u),
    u32(larger.exponent - smaller.exponent)
  );
  let resultSignificand = fp64_u64_add(largeSignificand, smallSignificand);
  return fp64_make_f32_bits_from_u64(sign, resultSignificand, larger.exponent - 55);
}

fn fp64_sub_aligned_magnitudes_to_f32_bits(sign: u32, larger: Fp64Bits, smaller: Fp64Bits) -> u32 {
  let largeSignificand = fp64_u64_shift_left(larger.significand, 3u);
  let smallSignificand = fp64_u64_shift_right_sticky(
    fp64_u64_shift_left(smaller.significand, 3u),
    u32(larger.exponent - smaller.exponent)
  );
  let resultSignificand = fp64_u64_sub(largeSignificand, smallSignificand);
  return fp64_make_f32_bits_from_u64(sign, resultSignificand, larger.exponent - 55);
}

// Subtract two raw binary64 values and round the exact result once to f32.
// The input words are canonical high/low words: .x contains sign/exponent/high
// fraction bits, and .y contains the low 32 fraction bits.
fn sub_fp64u32_to_f32_bits(aBits: vec2u, bBits: vec2u) -> u32 {
  let a = fp64_decode_bits(aBits);
  let b = fp64_decode_bits(bBits);
  let bSubtractionSign = b.sign ^ 1u;

  if (a.isNan || b.isNan) {
    return 0x7fc00000u;
  }
  if (a.isInf && b.isInf) {
    if (a.sign == bSubtractionSign) {
      return (a.sign << 31u) | 0x7f800000u;
    }
    return 0x7fc00000u;
  }
  if (a.isInf) {
    return (a.sign << 31u) | 0x7f800000u;
  }
  if (b.isInf) {
    return (bSubtractionSign << 31u) | 0x7f800000u;
  }
  if (a.isZero && b.isZero) {
    return select(0u, 0x80000000u, a.sign == 1u && b.sign == 0u);
  }

  let magnitudeComparison = fp64_finite_magnitude_compare(a, b);
  if (a.sign == bSubtractionSign) {
    if (magnitudeComparison >= 0) {
      return fp64_add_aligned_magnitudes_to_f32_bits(a.sign, a, b);
    }
    return fp64_add_aligned_magnitudes_to_f32_bits(a.sign, b, a);
  }

  if (magnitudeComparison == 0) {
    return 0u;
  }
  if (magnitudeComparison > 0) {
    return fp64_sub_aligned_magnitudes_to_f32_bits(a.sign, a, b);
  }
  return fp64_sub_aligned_magnitudes_to_f32_bits(bSubtractionSign, b, a);
}

fn sub_fp64u32_to_f32(aBits: vec2u, bBits: vec2u) -> f32 {
  return bitcast<f32>(sub_fp64u32_to_f32_bits(aBits, bBits));
}

// Subtract two raw binary64 values, round once to binary64, then split the
// result into normalized f32 limbs. Finite results must fit within the f32
// exponent range; larger magnitudes map to infinity and smaller magnitudes
// map to zero. The input words use canonical high/low word order.
fn sub_fp64u32_to_fp64_bits(aBits: vec2u, bBits: vec2u) -> vec2u {
  let a = fp64_decode_bits(aBits);
  let b = fp64_decode_bits(bBits);
  let bSubtractionSign = b.sign ^ 1u;

  if (a.isNan || b.isNan) {
    return vec2u(0x7fc00000u, 0u);
  }
  if (a.isInf && b.isInf) {
    if (a.sign == bSubtractionSign) {
      return vec2u((a.sign << 31u) | 0x7f800000u, 0u);
    }
    return vec2u(0x7fc00000u, 0u);
  }
  if (a.isInf) {
    return vec2u((a.sign << 31u) | 0x7f800000u, 0u);
  }
  if (b.isInf) {
    return vec2u((bSubtractionSign << 31u) | 0x7f800000u, 0u);
  }
  if (a.isZero && b.isZero) {
    return vec2u(0u);
  }

  let magnitudeComparison = fp64_finite_magnitude_compare(a, b);
  if (a.sign == bSubtractionSign) {
    if (magnitudeComparison >= 0) {
      return fp64_add_aligned_magnitudes_to_fp64_bits(a.sign, a, b);
    }
    return fp64_add_aligned_magnitudes_to_fp64_bits(a.sign, b, a);
  }

  if (magnitudeComparison == 0) {
    return vec2u(0u);
  }
  if (magnitudeComparison > 0) {
    return fp64_sub_aligned_magnitudes_to_fp64_bits(a.sign, a, b);
  }
  return fp64_sub_aligned_magnitudes_to_fp64_bits(bSubtractionSign, b, a);
}

fn sub_fp64u32_to_fp64(aBits: vec2u, bBits: vec2u) -> vec2f {
  let resultBits = sub_fp64u32_to_fp64_bits(aBits, bBits);
  return vec2f(bitcast<f32>(resultBits.x), bitcast<f32>(resultBits.y));
}
#endif

#ifndef LUMA_FP64_PREDICATE_ONLY
fn fp64_runtime_zero() -> f32 {
  return fp64arithmetic.ONE * 0.0;
}

fn prevent_fp64_optimization(value: f32) -> f32 {
#ifdef LUMA_FP64_CODE_ELIMINATION_WORKAROUND
  return value + fp64_runtime_zero();
#else
  return value;
#endif
}
#endif

#ifdef LUMA_FP64_INTEGER_ARITHMETIC
${an}
#else
fn split(a: f32) -> vec2f {
  let splitValue = prevent_fp64_optimization(fp64arithmetic.SPLIT + fp64_runtime_zero());
  let t = prevent_fp64_optimization(a * splitValue);
  let temp = prevent_fp64_optimization(t - a);
  let aHi = prevent_fp64_optimization(t - temp);
  let aLo = prevent_fp64_optimization(a - aHi);
  return vec2f(aHi, aLo);
}

fn split2(a: vec2f) -> vec2f {
  var b = split(a.x);
  b.y = b.y + a.y;
  return b;
}

fn quickTwoSum(a: f32, b: f32) -> vec2f {
#ifdef LUMA_FP64_CODE_ELIMINATION_WORKAROUND
  let sum = prevent_fp64_optimization((a + b) * fp64arithmetic.ONE);
  let err = prevent_fp64_optimization(b - (sum - a) * fp64arithmetic.ONE);
#else
  let sum = prevent_fp64_optimization(a + b);
  let err = prevent_fp64_optimization(b - (sum - a));
#endif
  return vec2f(sum, err);
}

fn twoSum(a: f32, b: f32) -> vec2f {
  let s = prevent_fp64_optimization(a + b);
#ifdef LUMA_FP64_CODE_ELIMINATION_WORKAROUND
  let v = prevent_fp64_optimization((s * fp64arithmetic.ONE - a) * fp64arithmetic.ONE);
  let err =
    prevent_fp64_optimization((a - (s - v) * fp64arithmetic.ONE) *
      fp64arithmetic.ONE *
      fp64arithmetic.ONE *
      fp64arithmetic.ONE) +
    prevent_fp64_optimization(b - v);
#else
  let v = prevent_fp64_optimization(s - a);
  let err = prevent_fp64_optimization(a - (s - v)) + prevent_fp64_optimization(b - v);
#endif
  return vec2f(s, err);
}

fn twoSub(a: f32, b: f32) -> vec2f {
  let s = prevent_fp64_optimization(a - b);
#ifdef LUMA_FP64_CODE_ELIMINATION_WORKAROUND
  let v = prevent_fp64_optimization((s * fp64arithmetic.ONE - a) * fp64arithmetic.ONE);
  let err =
    prevent_fp64_optimization((a - (s - v) * fp64arithmetic.ONE) *
      fp64arithmetic.ONE *
      fp64arithmetic.ONE *
      fp64arithmetic.ONE) -
    prevent_fp64_optimization(b + v);
#else
  let v = prevent_fp64_optimization(s - a);
  let err = prevent_fp64_optimization(a - (s - v)) - prevent_fp64_optimization(b + v);
#endif
  return vec2f(s, err);
}

fn twoSqr(a: f32) -> vec2f {
  let prod = prevent_fp64_optimization(a * a);
  let aFp64 = split(a);
  let highProduct = prevent_fp64_optimization(aFp64.x * aFp64.x);
  let crossProduct = prevent_fp64_optimization(2.0 * aFp64.x * aFp64.y);
  let lowProduct = prevent_fp64_optimization(aFp64.y * aFp64.y);
#ifdef LUMA_FP64_CODE_ELIMINATION_WORKAROUND
  let err =
    (prevent_fp64_optimization(highProduct - prod) * fp64arithmetic.ONE +
      crossProduct * fp64arithmetic.ONE * fp64arithmetic.ONE) +
    lowProduct * fp64arithmetic.ONE * fp64arithmetic.ONE * fp64arithmetic.ONE;
#else
  let err = ((prevent_fp64_optimization(highProduct - prod) + crossProduct) + lowProduct);
#endif
  return vec2f(prod, err);
}

fn twoProd(a: f32, b: f32) -> vec2f {
  let prod = prevent_fp64_optimization(a * b);
  let aFp64 = split(a);
  let bFp64 = split(b);
  let highProduct = prevent_fp64_optimization(aFp64.x * bFp64.x);
  let crossProduct1 = prevent_fp64_optimization(aFp64.x * bFp64.y);
  let crossProduct2 = prevent_fp64_optimization(aFp64.y * bFp64.x);
  let lowProduct = prevent_fp64_optimization(aFp64.y * bFp64.y);
#ifdef LUMA_FP64_CODE_ELIMINATION_WORKAROUND
  let err1 = (highProduct - prod) * fp64arithmetic.ONE;
  let err2 = crossProduct1 * fp64arithmetic.ONE * fp64arithmetic.ONE;
  let err3 = crossProduct2 * fp64arithmetic.ONE * fp64arithmetic.ONE * fp64arithmetic.ONE;
  let err4 =
    lowProduct *
    fp64arithmetic.ONE *
    fp64arithmetic.ONE *
    fp64arithmetic.ONE *
    fp64arithmetic.ONE;
#else
  let err1 = highProduct - prod;
  let err2 = crossProduct1;
  let err3 = crossProduct2;
  let err4 = lowProduct;
#endif
  let err12InputA = prevent_fp64_optimization(err1);
  let err12InputB = prevent_fp64_optimization(err2);
  let err12 = prevent_fp64_optimization(err12InputA + err12InputB);
  let err123InputA = prevent_fp64_optimization(err12);
  let err123InputB = prevent_fp64_optimization(err3);
  let err123 = prevent_fp64_optimization(err123InputA + err123InputB);
  let err1234InputA = prevent_fp64_optimization(err123);
  let err1234InputB = prevent_fp64_optimization(err4);
  let err = prevent_fp64_optimization(err1234InputA + err1234InputB);
  return vec2f(prod, err);
}

fn sum_fp64(a: vec2f, b: vec2f) -> vec2f {
  var s = twoSum(a.x, b.x);
  let t = twoSum(a.y, b.y);
  s.y = prevent_fp64_optimization(s.y + t.x);
  s = quickTwoSum(s.x, s.y);
  s.y = prevent_fp64_optimization(s.y + t.y);
  s = quickTwoSum(s.x, s.y);
  return s;
}

fn sub_fp64(a: vec2f, b: vec2f) -> vec2f {
  var s = twoSub(a.x, b.x);
  let t = twoSub(a.y, b.y);
  s.y = prevent_fp64_optimization(s.y + t.x);
  s = quickTwoSum(s.x, s.y);
  s.y = prevent_fp64_optimization(s.y + t.y);
  s = quickTwoSum(s.x, s.y);
  return s;
}

fn mul_fp64(a: vec2f, b: vec2f) -> vec2f {
  var prod = twoProd(a.x, b.x);
  let crossProduct1 = prevent_fp64_optimization(a.x * b.y);
  prod.y = prevent_fp64_optimization(prod.y + crossProduct1);
#ifdef LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND
  prod = split2(prod);
#endif
  prod = quickTwoSum(prod.x, prod.y);
  let crossProduct2 = prevent_fp64_optimization(a.y * b.x);
  prod.y = prevent_fp64_optimization(prod.y + crossProduct2);
#ifdef LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND
  prod = split2(prod);
#endif
  prod = quickTwoSum(prod.x, prod.y);
  return prod;
}

#ifndef LUMA_FP64_PREDICATE_ONLY
fn div_fp64(a: vec2f, b: vec2f) -> vec2f {
  let xn = prevent_fp64_optimization(1.0 / b.x);
  let yn = mul_fp64(a, vec2f(xn, fp64_runtime_zero()));
  let diff = prevent_fp64_optimization(sub_fp64(a, mul_fp64(b, yn)).x);
  let prod = twoProd(xn, diff);
  return sum_fp64(yn, prod);
}

fn sqrt_fp64(a: vec2f) -> vec2f {
  if (a.x == 0.0 && a.y == 0.0) {
    return vec2f(0.0, 0.0);
  }
  if (a.x < 0.0) {
    let nanValue = fp64_nan(a.x);
    return vec2f(nanValue, nanValue);
  }

  let x = prevent_fp64_optimization(1.0 / sqrt(a.x));
  let yn = prevent_fp64_optimization(a.x * x);
#ifdef LUMA_FP64_CODE_ELIMINATION_WORKAROUND
  let ynSqr = twoSqr(yn) * fp64arithmetic.ONE;
#else
  let ynSqr = twoSqr(yn);
#endif
  let diff = prevent_fp64_optimization(sub_fp64(a, ynSqr).x);
  let prod = twoProd(prevent_fp64_optimization(x * 0.5), diff);
#ifdef LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND
  return sum_fp64(split(yn), prod);
#else
  return sum_fp64(vec2f(yn, 0.0), prod);
#endif
}
#endif
#endif

#ifndef LUMA_FP64_PREDICATE_ONLY
fn fp64_f32_bits_is_nan(bits: u32) -> bool {
  return (bits & 0x7fffffffu) > 0x7f800000u;
}

fn fp64_f32_bits_is_inf(bits: u32) -> bool {
  return (bits & 0x7fffffffu) == 0x7f800000u;
}

fn fp64_compare_f32_bits(aBits: u32, bBits: u32) -> i32 {
  let aMagnitude = aBits & 0x7fffffffu;
  let bMagnitude = bBits & 0x7fffffffu;
  if (aMagnitude == 0u && bMagnitude == 0u) {
    return 0;
  }
  let aSign = aBits >> 31u;
  let bSign = bBits >> 31u;
  if (aSign != bSign) {
    return select(1, -1, aSign == 1u);
  }
  if (aMagnitude == bMagnitude) {
    return 0;
  }
  let magnitudeComparison = select(-1, 1, aMagnitude > bMagnitude);
  return select(magnitudeComparison, -magnitudeComparison, aSign == 1u);
}

// Normalize an arbitrary pair of finite f32 limbs with integer accumulation.
// This is independent of LUMA_FP64_INTEGER_ARITHMETIC and canonicalizes every
// representation of zero to vec2f(+0.0, +0.0).
fn normalize_fp64(value: vec2f) -> vec2f {
  let resultBits = fp64_add_raw_f32_bits(bitcast<u32>(value.x), bitcast<u32>(value.y));
  return vec2f(bitcast<f32>(resultBits.x), bitcast<f32>(resultBits.y));
}

fn is_nan_fp64(value: vec2f) -> bool {
  let normalized = normalize_fp64(value);
  return fp64_f32_bits_is_nan(bitcast<u32>(normalized.x)) ||
    fp64_f32_bits_is_nan(bitcast<u32>(normalized.y));
}

fn is_finite_fp64(value: vec2f) -> bool {
  let normalized = normalize_fp64(value);
  let highBits = bitcast<u32>(normalized.x);
  let lowBits = bitcast<u32>(normalized.y);
  return !fp64_f32_bits_is_nan(highBits) && !fp64_f32_bits_is_nan(lowBits) &&
    !fp64_f32_bits_is_inf(highBits) && !fp64_f32_bits_is_inf(lowBits);
}

// Returns -1, 0, or 1. NaN is unordered and returns 0; call is_nan_fp64 or
// is_finite_fp64 first when 0 must mean a finite zero.
fn sign_fp64(value: vec2f) -> i32 {
  let normalized = normalize_fp64(value);
  let highBits = bitcast<u32>(normalized.x);
  let lowBits = bitcast<u32>(normalized.y);
  if (fp64_f32_bits_is_nan(highBits) || fp64_f32_bits_is_nan(lowBits)) {
    return 0;
  }
  if ((highBits & 0x7fffffffu) != 0u) {
    return select(1, -1, (highBits >> 31u) == 1u);
  }
  if ((lowBits & 0x7fffffffu) != 0u) {
    return select(1, -1, (lowBits >> 31u) == 1u);
  }
  return 0;
}

// Compares double-single values and returns -1, 0, or 1. NaN is unordered
// and returns 0; callers that require equality semantics must first check
// is_nan_fp64 or is_finite_fp64.
fn compare_fp64(a: vec2f, b: vec2f) -> i32 {
  let normalizedA = normalize_fp64(a);
  let normalizedB = normalize_fp64(b);
  let aHighBits = bitcast<u32>(normalizedA.x);
  let aLowBits = bitcast<u32>(normalizedA.y);
  let bHighBits = bitcast<u32>(normalizedB.x);
  let bLowBits = bitcast<u32>(normalizedB.y);
  if (fp64_f32_bits_is_nan(aHighBits) || fp64_f32_bits_is_nan(aLowBits) ||
      fp64_f32_bits_is_nan(bHighBits) || fp64_f32_bits_is_nan(bLowBits)) {
    return 0;
  }
  let highComparison = fp64_compare_f32_bits(aHighBits, bHighBits);
  if (highComparison != 0) {
    return highComparison;
  }
  return fp64_compare_f32_bits(aLowBits, bLowBits);
}
#endif
`;var $o={ONE:1,SPLIT:4097},ko={name:"fp64arithmetic",source:un,fs:Pt,vs:Pt,defaultUniforms:$o,uniformTypes:{ONE:"f32",SPLIT:"f32"},fp64ify:Tt,fp64LowPart:rn,fp64ifyMatrix4:on};var k={RGBA8UNORM:0,RGBA16FLOAT:1,RGBA32FLOAT:2},zo={rgba8unorm:4,rgba16float:8,rgba32float:16},Vo={...zo},Lu={rgba8unorm:k.RGBA8UNORM,rgba16float:k.RGBA16FLOAT,rgba32float:k.RGBA32FLOAT},Su={[k.RGBA8UNORM]:"rgba8unorm",[k.RGBA16FLOAT]:"rgba16float",[k.RGBA32FLOAT]:"rgba32float"},Wo={useByteColors:"f32"},jo={useByteColors:!0};var Eu={format:k.RGBA8UNORM,wordStride:Vo.rgba8unorm/Uint32Array.BYTES_PER_ELEMENT,wordOffset:0,_padding:0},Au=ln("colors"),fn=ln("floatColors"),Bu=cn("colors"),Ho=cn("floatColors"),Iu=`struct storageColorsUniforms {
  format: u32,
  wordStride: u32,
  wordOffset: u32,
  _padding: u32
};

@group(0) @binding(auto) var<uniform> storageColors : storageColorsUniforms;
@group(0) @binding(auto) var<storage, read> storageColorsBuffer : array<u32>;

const STORAGE_COLOR_FORMAT_RGBA8UNORM : u32 = ${k.RGBA8UNORM}u;
const STORAGE_COLOR_FORMAT_RGBA16FLOAT : u32 = ${k.RGBA16FLOAT}u;

fn storageColors_getWordIndex(rowIndex: u32) -> u32 {
  return storageColors.wordOffset + rowIndex * storageColors.wordStride;
}

fn storageColors_readRgba8UnormColor(wordIndex: u32) -> vec4<f32> {
  return unpack4x8unorm(storageColorsBuffer[wordIndex]);
}

fn storageColors_readRgba16FloatColor(wordIndex: u32) -> vec4<f32> {
  let redGreen = unpack2x16float(storageColorsBuffer[wordIndex]);
  let blueAlpha = unpack2x16float(storageColorsBuffer[wordIndex + 1u]);
  return vec4<f32>(redGreen.x, redGreen.y, blueAlpha.x, blueAlpha.y);
}

fn storageColors_readRgba32FloatColor(wordIndex: u32) -> vec4<f32> {
  return vec4<f32>(
    bitcast<f32>(storageColorsBuffer[wordIndex]),
    bitcast<f32>(storageColorsBuffer[wordIndex + 1u]),
    bitcast<f32>(storageColorsBuffer[wordIndex + 2u]),
    bitcast<f32>(storageColorsBuffer[wordIndex + 3u])
  );
}

fn storageColors_readColor(rowIndex: u32) -> vec4<f32> {
  let wordIndex = storageColors_getWordIndex(rowIndex);
  if (storageColors.format == STORAGE_COLOR_FORMAT_RGBA8UNORM) {
    return storageColors_readRgba8UnormColor(wordIndex);
  }
  if (storageColors.format == STORAGE_COLOR_FORMAT_RGBA16FLOAT) {
    return storageColors_readRgba16FloatColor(wordIndex);
  }
  return storageColors_readRgba32FloatColor(wordIndex);
}
`;function ln(t){return`layout(std140) uniform ${t}Uniforms {
  float useByteColors;
} ${t};

vec3 ${t}_normalize(vec3 inputColor) {
  return ${t}.useByteColors > 0.5 ? inputColor / 255.0 : inputColor;
}

vec4 ${t}_normalize(vec4 inputColor) {
  return ${t}.useByteColors > 0.5 ? inputColor / 255.0 : inputColor;
}

vec4 ${t}_premultiplyAlpha(vec4 inputColor) {
  return vec4(inputColor.rgb * inputColor.a, inputColor.a);
}

vec4 ${t}_unpremultiplyAlpha(vec4 inputColor) {
  return inputColor.a > 0.0 ? vec4(inputColor.rgb / inputColor.a, inputColor.a) : vec4(0.0);
}

vec4 ${t}_premultiply_alpha(vec4 inputColor) {
  return ${t}_premultiplyAlpha(inputColor);
}

vec4 ${t}_unpremultiply_alpha(vec4 inputColor) {
  return ${t}_unpremultiplyAlpha(inputColor);
}
`}function cn(t){return`struct ${t}Uniforms {
  useByteColors: f32
};

@group(0) @binding(auto) var<uniform> ${t} : ${t}Uniforms;

fn ${t}_normalize(inputColor: vec3<f32>) -> vec3<f32> {
  return select(inputColor, inputColor / 255.0, ${t}.useByteColors > 0.5);
}

fn ${t}_normalize4(inputColor: vec4<f32>) -> vec4<f32> {
  return select(inputColor, inputColor / 255.0, ${t}.useByteColors > 0.5);
}

fn ${t}_premultiplyAlpha(inputColor: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(inputColor.rgb * inputColor.a, inputColor.a);
}

fn ${t}_unpremultiplyAlpha(inputColor: vec4<f32>) -> vec4<f32> {
  return select(
    vec4<f32>(0.0),
    vec4<f32>(inputColor.rgb / inputColor.a, inputColor.a),
    inputColor.a > 0.0
  );
}

fn ${t}_premultiply_alpha(inputColor: vec4<f32>) -> vec4<f32> {
  return ${t}_premultiplyAlpha(inputColor);
}

fn ${t}_unpremultiply_alpha(inputColor: vec4<f32>) -> vec4<f32> {
  return ${t}_unpremultiplyAlpha(inputColor);
}
`}var Xe={name:"floatColors",props:{},uniforms:{},vs:fn,fs:fn,source:Ho,uniformTypes:Wo,defaultUniforms:jo};var qo=[0,1,1,1],Zo=`layout(std140) uniform pickingUniforms {
  float isActive;
  float isAttribute;
  float isHighlightActive;
  float useByteColors;
  vec3 highlightedObjectColor;
  vec4 highlightColor;
} picking;

out vec4 picking_vRGBcolor_Avalid;

// Normalize unsigned byte color to 0-1 range
vec3 picking_normalizeColor(vec3 color) {
  return picking.useByteColors > 0.5 ? color / 255.0 : color;
}

// Normalize unsigned byte color to 0-1 range
vec4 picking_normalizeColor(vec4 color) {
  return picking.useByteColors > 0.5 ? color / 255.0 : color;
}

bool picking_isColorZero(vec3 color) {
  return dot(color, vec3(1.0)) < 0.00001;
}

bool picking_isColorValid(vec3 color) {
  return dot(color, vec3(1.0)) > 0.00001;
}

// Check if this vertex is highlighted 
bool isVertexHighlighted(vec3 vertexColor) {
  vec3 highlightedObjectColor = picking_normalizeColor(picking.highlightedObjectColor);
  return
    bool(picking.isHighlightActive) && picking_isColorZero(abs(vertexColor - highlightedObjectColor));
}

// Set the current picking color
void picking_setPickingColor(vec3 pickingColor) {
  pickingColor = picking_normalizeColor(pickingColor);

  if (bool(picking.isActive)) {
    // Use alpha as the validity flag. If pickingColor is [0, 0, 0] fragment is non-pickable
    picking_vRGBcolor_Avalid.a = float(picking_isColorValid(pickingColor));

    if (!bool(picking.isAttribute)) {
      // Stores the picking color so that the fragment shader can render it during picking
      picking_vRGBcolor_Avalid.rgb = pickingColor;
    }
  } else {
    // Do the comparison with selected item color in vertex shader as it should mean fewer compares
    picking_vRGBcolor_Avalid.a = float(isVertexHighlighted(pickingColor));
  }
}

void picking_setPickingAttribute(float value) {
  if (bool(picking.isAttribute)) {
    picking_vRGBcolor_Avalid.r = value;
  }
}

void picking_setPickingAttribute(vec2 value) {
  if (bool(picking.isAttribute)) {
    picking_vRGBcolor_Avalid.rg = value;
  }
}

void picking_setPickingAttribute(vec3 value) {
  if (bool(picking.isAttribute)) {
    picking_vRGBcolor_Avalid.rgb = value;
  }
}
`,Xo=`layout(std140) uniform pickingUniforms {
  float isActive;
  float isAttribute;
  float isHighlightActive;
  float useByteColors;
  vec3 highlightedObjectColor;
  vec4 highlightColor;
} picking;

in vec4 picking_vRGBcolor_Avalid;

/*
 * Returns highlight color if this item is selected.
 */
vec4 picking_filterHighlightColor(vec4 color) {
  // If we are still picking, we don't highlight
  if (picking.isActive > 0.5) {
    return color;
  }

  bool selected = bool(picking_vRGBcolor_Avalid.a);

  if (selected) {
    // Blend in highlight color based on its alpha value
    float highLightAlpha = picking.highlightColor.a;
    float blendedAlpha = highLightAlpha + color.a * (1.0 - highLightAlpha);
    float highLightRatio = highLightAlpha / blendedAlpha;

    vec3 blendedRGB = mix(color.rgb, picking.highlightColor.rgb, highLightRatio);
    return vec4(blendedRGB, blendedAlpha);
  } else {
    return color;
  }
}

/*
 * Returns picking color if picking enabled else unmodified argument.
 */
vec4 picking_filterPickingColor(vec4 color) {
  if (bool(picking.isActive)) {
    if (picking_vRGBcolor_Avalid.a == 0.0) {
      discard;
    }
    return picking_vRGBcolor_Avalid;
  }
  return color;
}

/*
 * Returns picking color if picking is enabled if not
 * highlight color if this item is selected, otherwise unmodified argument.
 */
vec4 picking_filterColor(vec4 color) {
  vec4 highlightColor = picking_filterHighlightColor(color);
  return picking_filterPickingColor(highlightColor);
}
`,Ko={props:{},uniforms:{},name:"picking",uniformTypes:{isActive:"f32",isAttribute:"f32",isHighlightActive:"f32",useByteColors:"f32",highlightedObjectColor:"vec3<f32>",highlightColor:"vec4<f32>"},defaultUniforms:{isActive:!1,isAttribute:!1,isHighlightActive:!1,useByteColors:!0,highlightedObjectColor:[0,0,0],highlightColor:qo},vs:Zo,fs:Xo,getUniforms:Yo};function Yo(t={},e){let i={},n=Ze(t.useByteColors,!0);if(t.highlightedObjectColor!==void 0)if(t.highlightedObjectColor===null)i.isHighlightActive=!1;else{i.isHighlightActive=!0;let r=t.highlightedObjectColor.slice(0,3);i.highlightedObjectColor=r}return t.highlightColor&&(i.highlightColor=sn(t.highlightColor,n)),t.isActive!==void 0&&(i.isActive=!!t.isActive,i.isAttribute=!!t.isAttribute),t.useByteColors!==void 0&&(i.useByteColors=!!t.useByteColors),i}var Ct=`precision highp int;

// #if (defined(SHADER_TYPE_FRAGMENT) && defined(LIGHTING_FRAGMENT)) || (defined(SHADER_TYPE_VERTEX) && defined(LIGHTING_VERTEX))
struct AmbientLight {
  vec3 color;
};

struct PointLight {
  vec3 color;
  vec3 position;
  vec3 attenuation; // 2nd order x:Constant-y:Linear-z:Exponential
};

struct SpotLight {
  vec3 color;
  vec3 position;
  vec3 direction;
  vec3 attenuation;
  vec2 coneCos;
};

struct DirectionalLight {
  vec3 color;
  vec3 direction;
};

struct UniformLight {
  vec3 color;
  vec3 position;
  vec3 direction;
  vec3 attenuation;
  vec2 coneCos;
};

layout(std140) uniform lightingUniforms {
  int enabled;
  int directionalLightCount;
  int pointLightCount;
  int spotLightCount;
  vec3 ambientColor;
  UniformLight lights[5];
} lighting;

PointLight lighting_getPointLight(int index) {
  UniformLight light = lighting.lights[index];
  return PointLight(light.color, light.position, light.attenuation);
}

SpotLight lighting_getSpotLight(int index) {
  UniformLight light = lighting.lights[lighting.pointLightCount + index];
  return SpotLight(light.color, light.position, light.direction, light.attenuation, light.coneCos);
}

DirectionalLight lighting_getDirectionalLight(int index) {
  UniformLight light =
    lighting.lights[lighting.pointLightCount + lighting.spotLightCount + index];
  return DirectionalLight(light.color, light.direction);
}

float getPointLightAttenuation(PointLight pointLight, float distance) {
  return pointLight.attenuation.x
       + pointLight.attenuation.y * distance
       + pointLight.attenuation.z * distance * distance;
}

float getSpotLightAttenuation(SpotLight spotLight, vec3 positionWorldspace) {
  vec3 light_direction = normalize(positionWorldspace - spotLight.position);
  float coneFactor = smoothstep(
    spotLight.coneCos.y,
    spotLight.coneCos.x,
    dot(normalize(spotLight.direction), light_direction)
  );
  float distanceAttenuation = getPointLightAttenuation(
    PointLight(spotLight.color, spotLight.position, spotLight.attenuation),
    distance(spotLight.position, positionWorldspace)
  );
  return distanceAttenuation / max(coneFactor, 0.0001);
}

// #endif
`;var dn=`// #if (defined(SHADER_TYPE_FRAGMENT) && defined(LIGHTING_FRAGMENT)) || (defined(SHADER_TYPE_VERTEX) && defined(LIGHTING_VERTEX))
const MAX_LIGHTS: i32 = 5;

struct AmbientLight {
  color: vec3<f32>,
};

struct PointLight {
  color: vec3<f32>,
  position: vec3<f32>,
  attenuation: vec3<f32>, // 2nd order x:Constant-y:Linear-z:Exponential
};

struct SpotLight {
  color: vec3<f32>,
  position: vec3<f32>,
  direction: vec3<f32>,
  attenuation: vec3<f32>,
  coneCos: vec2<f32>,
};

struct DirectionalLight {
  color: vec3<f32>,
  direction: vec3<f32>,
};

struct UniformLight {
  color: vec3<f32>,
  position: vec3<f32>,
  direction: vec3<f32>,
  attenuation: vec3<f32>,
  coneCos: vec2<f32>,
};

struct lightingUniforms {
  enabled: i32,
  directionalLightCount: i32,
  pointLightCount: i32,
  spotLightCount: i32,
  ambientColor: vec3<f32>,
  lights: array<UniformLight, 5>,
};

@group(2) @binding(auto) var<uniform> lighting : lightingUniforms;

fn lighting_getPointLight(index: i32) -> PointLight {
  let light = lighting.lights[index];
  return PointLight(light.color, light.position, light.attenuation);
}

fn lighting_getSpotLight(index: i32) -> SpotLight {
  let light = lighting.lights[lighting.pointLightCount + index];
  return SpotLight(light.color, light.position, light.direction, light.attenuation, light.coneCos);
}

fn lighting_getDirectionalLight(index: i32) -> DirectionalLight {
  let light = lighting.lights[lighting.pointLightCount + lighting.spotLightCount + index];
  return DirectionalLight(light.color, light.direction);
}

fn getPointLightAttenuation(pointLight: PointLight, distance: f32) -> f32 {
  return pointLight.attenuation.x
       + pointLight.attenuation.y * distance
       + pointLight.attenuation.z * distance * distance;
}

fn getSpotLightAttenuation(spotLight: SpotLight, positionWorldspace: vec3<f32>) -> f32 {
  let lightDirection = normalize(positionWorldspace - spotLight.position);
  let coneFactor = smoothstep(
    spotLight.coneCos.y,
    spotLight.coneCos.x,
    dot(normalize(spotLight.direction), lightDirection)
  );
  let distanceAttenuation = getPointLightAttenuation(
    PointLight(spotLight.color, spotLight.position, spotLight.attenuation),
    distance(spotLight.position, positionWorldspace)
  );
  return distanceAttenuation / max(coneFactor, 0.0001);
}
`;var Q=5,Jo={color:"vec3<f32>",position:"vec3<f32>",direction:"vec3<f32>",attenuation:"vec3<f32>",coneCos:"vec2<f32>"},Je={props:{},uniforms:{},name:"lighting",defines:{},uniformTypes:{enabled:"i32",directionalLightCount:"i32",pointLightCount:"i32",spotLightCount:"i32",ambientColor:"vec3<f32>",lights:[Jo,Q]},defaultUniforms:Ye(),bindingLayout:[{name:"lighting",group:2}],firstBindingSlot:0,source:dn,vs:Ct,fs:Ct,getUniforms:Qo};function Qo(t,e={}){if(t=t&&{...t},!t)return Ye();t.lights&&(t={...t,...ts(t.lights),lights:void 0});let{useByteColors:i,ambientLight:n,pointLights:r,spotLights:o,directionalLights:s}=t||{};if(!(n||r&&r.length>0||o&&o.length>0||s&&s.length>0))return{...Ye(),enabled:0};let u={...Ye(),...es({useByteColors:i,ambientLight:n,pointLights:r,spotLights:o,directionalLights:s})};return t.enabled!==void 0&&(u.enabled=t.enabled?1:0),u}function es({useByteColors:t,ambientLight:e,pointLights:i=[],spotLights:n=[],directionalLights:r=[]}){let o=hn(),s=0,a=0,u=0,f=0;for(let l of i){if(s>=Q)break;o[s]={...o[s],color:Ke(l,t),position:l.position,attenuation:l.attenuation||[1,0,0]},s++,a++}for(let l of n){if(s>=Q)break;o[s]={...o[s],color:Ke(l,t),position:l.position,direction:l.direction,attenuation:l.attenuation||[1,0,0],coneCos:ns(l)},s++,u++}for(let l of r){if(s>=Q)break;o[s]={...o[s],color:Ke(l,t),direction:l.direction},s++,f++}return i.length+n.length+r.length>Q&&_.warn(`MAX_LIGHTS exceeded, truncating to ${Q}`)(),{ambientColor:Ke(e,t),directionalLightCount:f,pointLightCount:a,spotLightCount:u,lights:o}}function ts(t){let e={pointLights:[],spotLights:[],directionalLights:[]};for(let i of t||[])switch(i.type){case"ambient":e.ambientLight=i;break;case"directional":e.directionalLights?.push(i);break;case"point":e.pointLights?.push(i);break;case"spot":e.spotLights?.push(i);break;default:}return e}function Ke(t={},e){let{color:i=[0,0,0],intensity:n=1}=t;return Ot(i,Ze(e,!0)).map(o=>o*n)}function Ye(){return{enabled:1,directionalLightCount:0,pointLightCount:0,spotLightCount:0,ambientColor:[.1,.1,.1],lights:hn()}}function hn(){return Array.from({length:Q},()=>is())}function is(){return{color:[1,1,1],position:[1,1,2],direction:[1,1,1],attenuation:[1,0,0],coneCos:[1,0]}}function ns(t){let e=t.innerConeAngle??0,i=t.outerConeAngle??Math.PI/4;return[Math.cos(e),Math.cos(i)]}var Qe=`layout(std140) uniform phongMaterialUniforms {
  uniform bool unlit;
  uniform float ambient;
  uniform float diffuse;
  uniform float shininess;
  uniform vec3  specularColor;
} material;
`,et=`layout(std140) uniform phongMaterialUniforms {
  uniform bool unlit;
  uniform float ambient;
  uniform float diffuse;
  uniform float shininess;
  uniform vec3  specularColor;
} material;

vec3 lighting_getLightColor(vec3 surfaceColor, vec3 light_direction, vec3 view_direction, vec3 normal_worldspace, vec3 color) {
  vec3 halfway_direction = normalize(light_direction + view_direction);
  float lambertian = dot(light_direction, normal_worldspace);
  float specular = 0.0;
  if (lambertian > 0.0) {
    float specular_angle = max(dot(normal_worldspace, halfway_direction), 0.0);
    specular = pow(specular_angle, material.shininess);
  }
  lambertian = max(lambertian, 0.0);
  return (lambertian * material.diffuse * surfaceColor + specular * floatColors_normalize(material.specularColor)) * color;
}

vec3 lighting_getLightColor(vec3 surfaceColor, vec3 cameraPosition, vec3 position_worldspace, vec3 normal_worldspace) {
  vec3 lightColor = surfaceColor;

  if (material.unlit) {
    return surfaceColor;
  }

  if (lighting.enabled == 0) {
    return lightColor;
  }

  vec3 view_direction = normalize(cameraPosition - position_worldspace);
  lightColor = material.ambient * surfaceColor * lighting.ambientColor;

  for (int i = 0; i < lighting.pointLightCount; i++) {
    PointLight pointLight = lighting_getPointLight(i);
    vec3 light_position_worldspace = pointLight.position;
    vec3 light_direction = normalize(light_position_worldspace - position_worldspace);
    float light_attenuation = getPointLightAttenuation(pointLight, distance(light_position_worldspace, position_worldspace));
    lightColor += lighting_getLightColor(surfaceColor, light_direction, view_direction, normal_worldspace, pointLight.color / light_attenuation);
  }

  for (int i = 0; i < lighting.spotLightCount; i++) {
    SpotLight spotLight = lighting_getSpotLight(i);
    vec3 light_position_worldspace = spotLight.position;
    vec3 light_direction = normalize(light_position_worldspace - position_worldspace);
    float light_attenuation = getSpotLightAttenuation(spotLight, position_worldspace);
    lightColor += lighting_getLightColor(surfaceColor, light_direction, view_direction, normal_worldspace, spotLight.color / light_attenuation);
  }

  for (int i = 0; i < lighting.directionalLightCount; i++) {
    DirectionalLight directionalLight = lighting_getDirectionalLight(i);
    lightColor += lighting_getLightColor(surfaceColor, -directionalLight.direction, view_direction, normal_worldspace, directionalLight.color);
  }
  
  return lightColor;
}
`;var tt=`struct phongMaterialUniforms {
  unlit: u32,
  ambient: f32,
  diffuse: f32,
  shininess: f32,
  specularColor: vec3<f32>,
};

@group(3) @binding(auto) var<uniform> phongMaterial : phongMaterialUniforms;

fn lighting_getLightColor(surfaceColor: vec3<f32>, light_direction: vec3<f32>, view_direction: vec3<f32>, normal_worldspace: vec3<f32>, color: vec3<f32>) -> vec3<f32> {
  let halfway_direction: vec3<f32> = normalize(light_direction + view_direction);
  var lambertian: f32 = dot(light_direction, normal_worldspace);
  var specular: f32 = 0.0;
  if (lambertian > 0.0) {
    let specular_angle = max(dot(normal_worldspace, halfway_direction), 0.0);
    specular = pow(specular_angle, phongMaterial.shininess);
  }
  lambertian = max(lambertian, 0.0);
  return (
    lambertian * phongMaterial.diffuse * surfaceColor +
    specular * floatColors_normalize(phongMaterial.specularColor)
  ) * color;
}

fn lighting_getLightColor2(surfaceColor: vec3<f32>, cameraPosition: vec3<f32>, position_worldspace: vec3<f32>, normal_worldspace: vec3<f32>) -> vec3<f32> {
  var lightColor: vec3<f32> = surfaceColor;

  if (phongMaterial.unlit != 0u) {
    return surfaceColor;
  }

  if (lighting.enabled == 0) {
    return lightColor;
  }

  let view_direction: vec3<f32> = normalize(cameraPosition - position_worldspace);
  lightColor = phongMaterial.ambient * surfaceColor * lighting.ambientColor;

  for (var i: i32 = 0; i < lighting.pointLightCount; i++) {
    let pointLight: PointLight = lighting_getPointLight(i);
    let light_position_worldspace: vec3<f32> = pointLight.position;
    let light_direction: vec3<f32> = normalize(light_position_worldspace - position_worldspace);
    let light_attenuation = getPointLightAttenuation(
      pointLight,
      distance(light_position_worldspace, position_worldspace)
    );
    lightColor += lighting_getLightColor(
      surfaceColor,
      light_direction,
      view_direction,
      normal_worldspace,
      pointLight.color / light_attenuation
    );
  }

  for (var i: i32 = 0; i < lighting.spotLightCount; i++) {
    let spotLight: SpotLight = lighting_getSpotLight(i);
    let light_position_worldspace: vec3<f32> = spotLight.position;
    let light_direction: vec3<f32> = normalize(light_position_worldspace - position_worldspace);
    let light_attenuation = getSpotLightAttenuation(spotLight, position_worldspace);
    lightColor += lighting_getLightColor(
      surfaceColor,
      light_direction,
      view_direction,
      normal_worldspace,
      spotLight.color / light_attenuation
    );
  }

  for (var i: i32 = 0; i < lighting.directionalLightCount; i++) {
    let directionalLight: DirectionalLight = lighting_getDirectionalLight(i);
    lightColor += lighting_getLightColor(surfaceColor, -directionalLight.direction, view_direction, normal_worldspace, directionalLight.color);
  }  
  
  return lightColor;
}

fn lighting_getSpecularLightColor(cameraPosition: vec3<f32>, position_worldspace: vec3<f32>, normal_worldspace: vec3<f32>) -> vec3<f32>{
  var lightColor = vec3<f32>(0, 0, 0);
  let surfaceColor = vec3<f32>(0, 0, 0);

  if (lighting.enabled != 0) {
    let view_direction = normalize(cameraPosition - position_worldspace);

    for (var i: i32 = 0; i < lighting.pointLightCount; i++) {
      let pointLight: PointLight = lighting_getPointLight(i);
      let light_position_worldspace: vec3<f32> = pointLight.position;
      let light_direction: vec3<f32> = normalize(light_position_worldspace - position_worldspace);
      let light_attenuation = getPointLightAttenuation(
        pointLight,
        distance(light_position_worldspace, position_worldspace)
      );
      lightColor += lighting_getLightColor(
        surfaceColor,
        light_direction,
        view_direction,
        normal_worldspace,
        pointLight.color / light_attenuation
      );
    }

    for (var i: i32 = 0; i < lighting.spotLightCount; i++) {
      let spotLight: SpotLight = lighting_getSpotLight(i);
      let light_position_worldspace: vec3<f32> = spotLight.position;
      let light_direction: vec3<f32> = normalize(light_position_worldspace - position_worldspace);
      let light_attenuation = getSpotLightAttenuation(spotLight, position_worldspace);
      lightColor += lighting_getLightColor(
        surfaceColor,
        light_direction,
        view_direction,
        normal_worldspace,
        spotLight.color / light_attenuation
      );
    }

    for (var i: i32 = 0; i < lighting.directionalLightCount; i++) {
        let directionalLight: DirectionalLight = lighting_getDirectionalLight(i);
        lightColor += lighting_getLightColor(surfaceColor, -directionalLight.direction, view_direction, normal_worldspace, directionalLight.color);
    }
  }
  return lightColor;
}
`;var rs=[38.25,38.25,38.25],pn={props:{},name:"gouraudMaterial",bindingLayout:[{name:"gouraudMaterial",group:3}],vs:et.replace("phongMaterial","gouraudMaterial"),fs:Qe.replace("phongMaterial","gouraudMaterial"),source:tt.replaceAll("phongMaterial","gouraudMaterial"),defines:{LIGHTING_VERTEX:!0},dependencies:[Je,Xe],uniformTypes:{unlit:"i32",ambient:"f32",diffuse:"f32",shininess:"f32",specularColor:"vec3<f32>"},defaultUniforms:{unlit:!1,ambient:.35,diffuse:.6,shininess:32,specularColor:rs},getUniforms(t){return{...pn.defaultUniforms,...t}}};var os=[38.25,38.25,38.25],gn={name:"phongMaterial",firstBindingSlot:0,bindingLayout:[{name:"phongMaterial",group:3}],dependencies:[Je,Xe],source:tt,vs:Qe,fs:et,defines:{LIGHTING_FRAGMENT:!0},uniformTypes:{unlit:"i32",ambient:"f32",diffuse:"f32",shininess:"f32",specularColor:"vec3<f32>"},defaultUniforms:{unlit:!1,ambient:.35,diffuse:.6,shininess:32,specularColor:os},getUniforms(t){return{...gn.defaultUniforms,...t}}};var Nt={};function T(t="id"){Nt[t]=Nt[t]||1;let e=Nt[t]++;return`${t}-${e}`}var ee=class{id;topology;vertexCount;indices;attributes;bufferLayout;userData={};constructor(e){let{attributes:i={},indices:n=null,vertexCount:r=null}=e;this.id=e.id||T("geometry"),this.topology=e.topology,n&&(this.indices=ArrayBuffer.isView(n)?{value:n,size:1}:n),this.attributes={};for(let[o,s]of Object.entries(i)){let a=ArrayBuffer.isView(s)?{value:s}:s;if(!ArrayBuffer.isView(a.value))throw new Error(`${this._print(o)}: must be typed array or object with value as typed array`);if((o==="POSITION"||o==="positions")&&!a.size&&(a.size=3),o==="indices"){if(this.indices)throw new Error("Multiple indices detected");this.indices=a}else{let u=te(o),f=Object.keys(this.attributes).find(l=>te(l)===u);f&&delete this.attributes[f],this.attributes[o]=a}}this.indices&&this.indices.isIndexed!==void 0&&(this.indices=Object.assign({},this.indices),delete this.indices.isIndexed),this.vertexCount=r||this._calculateVertexCount(this.attributes,this.indices),this.bufferLayout=e.bufferLayout||ss(this.attributes)}getVertexCount(){return this.vertexCount}getAttributes(){return this.indices?{indices:this.indices,...this.attributes}:this.attributes}_print(e){return`Geometry ${this.id} attribute ${e}`}_setAttributes(e,i){return this}_calculateVertexCount(e,i){if(i)return i.value.length;let n=1/0;for(let r of Object.values(e)){if(!r)continue;let{value:o,size:s,constant:a}=r;!a&&o&&s!==void 0&&s>=1&&(n=Math.min(n,o.length/s))}return n}};function te(t){switch(t){case"POSITION":return"positions";case"NORMAL":return"normals";case"TEXCOORD_0":return"texCoords";case"TEXCOORD_1":return"texCoords1";case"COLOR_0":return"colors";default:return t}}function ss(t){let e=[];for(let[i,n]of Object.entries(t)){if(!n)continue;let{value:r,size:o,normalized:s}=n;if(o===void 0)throw new Error(`Attribute ${i} is missing a size`);e.push({name:te(i),format:I.getVertexFormatFromAttribute(r,o,s)})}return e}function Rt(t,e={}){let i=e.bufferName||"geometry";if(as(t,i))return t;let n=e.minAttributeAlignment||4,r=us(t,e.attributes),o=[],s=0,a=1/0;for(let[l,d]of r){if(!d)continue;if(d.constant)throw new Error(`Attribute ${l} is constant`);let{value:h,size:c,normalized:p}=d;if(!ArrayBuffer.isView(h))throw new Error(`Attribute ${l} is missing typed array data`);if(c===void 0)throw new Error(`Attribute ${l} is missing a size`);let g=I.getVertexFormatFromAttribute(h,c,p),m=I.getVertexFormatInfo(g);s=mn(s,n),o.push({sourceName:l,attributeName:te(l),value:h,size:c,format:g,byteOffset:s,byteLength:m.byteLength}),s+=m.byteLength;let v=h.length/c;if(!Number.isInteger(v))throw new Error(`Attribute ${l} length is not divisible by size`);a=Math.min(a,v)}if(o.length===0||!Number.isFinite(a))throw new Error(`Geometry ${t.id} has no interleavable attributes`);let u=mn(s,n),f=new ArrayBuffer(a*u);for(let l of o)fs(f,a,u,l);return new ee({id:t.id,topology:t.topology||"triangle-list",vertexCount:t.vertexCount,indices:t.indices,attributes:{[i]:{value:new Uint8Array(f),size:u,byteStride:u}},bufferLayout:[{name:i,stepMode:"vertex",byteStride:u,attributes:o.map(l=>({attribute:l.attributeName,format:l.format,byteOffset:l.byteOffset}))}]})}function as(t,e){if(t.bufferLayout.length!==1)return!1;let i=t.bufferLayout[0];return i.name===e&&!!i.attributes?.length&&!!t.attributes[e]}function us(t,e){return e?e.map(i=>[i,t.attributes[i]]):Object.entries(t.attributes)}function fs(t,e,i,n){let r=n.value.constructor,o=r.BYTES_PER_ELEMENT;if(n.byteOffset%o!==0||i%o!==0)throw new Error(`Attribute ${n.sourceName} is not aligned to its component type`);let s=new r(t),a=n.value,u=n.byteOffset/o,f=i/o;for(let l=0;l<e;l++){let d=l*n.size,h=l*f+u;for(let c=0;c<n.size;c++)s[h+c]=a[d+c]}}function mn(t,e){return Math.ceil(t/e)*e}var it=class{id;userData={};topology;bufferLayout=[];vertexCount;indices;attributes;constructor(e){if(this.id=e.id||T("geometry"),this.topology=e.topology,this.indices=e.indices||null,this.attributes=e.attributes,this.vertexCount=e.vertexCount,this.bufferLayout=e.bufferLayout||[],this.indices&&!(this.indices.usage&A.INDEX))throw new Error("Index buffer must have INDEX usage")}destroy(){this.indices?.destroy();for(let e of Object.values(this.attributes))e.destroy()}getVertexCount(){return this.vertexCount}getAttributes(){return this.attributes}getIndexes(){return this.indices||null}_calculateVertexCount(e){return e.byteLength/12}};function _n(t,e){if(e instanceof it)return e;let i=Rt(e),n=ls(t,i),{attributes:r,bufferLayout:o}=cs(t,i);return new it({topology:i.topology||"triangle-list",bufferLayout:o,vertexCount:i.vertexCount,indices:n,attributes:r})}function ls(t,e){if(!e.indices)return;let i=e.indices.value;return t.createBuffer({usage:A.INDEX,data:i})}function cs(t,e){let i={};for(let[n,r]of Object.entries(e.attributes)){let o=e.bufferLayout.find(s=>s.name===n)?.name||te(n);r&&(i[o]=t.createBuffer({data:r.value,id:`${n}-buffer`}))}return{attributes:i,bufferLayout:e.bufferLayout,vertexCount:e.vertexCount}}function bn(t,e){let i={},n="Values";if(t.attributes.length===0&&!t.varyings?.length)return{"No attributes or varyings":{[n]:"N/A"}};for(let r of t.attributes)if(r){let o=`${r.location} ${r.name}: ${r.type}`;i[`in ${o}`]={[n]:r.stepMode||"vertex"}}for(let r of t.varyings||[]){let o=`${r.location} ${r.name}`;i[`out ${o}`]={[n]:JSON.stringify(r)}}return i}var yn="__debugFramebufferState";function xn(t,e,i){if(t.device.type!=="webgl")return;let n=ps(t.device);if(!n.flushing){if(ms(t)){ds(t,i,n);return}e&&gs(e)&&e.handle!==null&&(n.queuedFramebuffers.includes(e)||n.queuedFramebuffers.push(e))}}function ds(t,e,i){if(i.queuedFramebuffers.length===0)return;let n=t.device,{gl:r}=n,o=r.getParameter(36010),s=r.getParameter(36006),[a,u]=t.device.getDefaultCanvasContext().getDrawingBufferSize(),f=vn(e.top,8),l=vn(e.left,8);i.flushing=!0;try{for(let d of i.queuedFramebuffers){let[h,c,p,g,m]=hs({framebuffer:d,targetWidth:a,targetHeight:u,topPx:f,leftPx:l,minimap:e.minimap});r.bindFramebuffer(36008,d.handle),r.bindFramebuffer(36009,null),r.blitFramebuffer(0,0,d.width,d.height,h,c,p,g,16384,9728),f+=m+8}}finally{r.bindFramebuffer(36008,o),r.bindFramebuffer(36009,s),i.flushing=!1}}function hs(t){let{framebuffer:e,targetWidth:i,targetHeight:n,topPx:r,leftPx:o,minimap:s}=t,a=s?Math.max(Math.floor(i/4),1):i,u=s?Math.max(Math.floor(n/4),1):n,f=Math.min(a/e.width,u/e.height),l=Math.max(Math.floor(e.width*f),1),d=Math.max(Math.floor(e.height*f),1),h=o,c=Math.max(n-r-d,0),p=h+l,g=c+d;return[h,c,p,g,d]}function ps(t){return t.userData[yn]||={flushing:!1,queuedFramebuffers:[]},t.userData[yn]}function gs(t){return"colorAttachments"in t}function ms(t){let e=t.props.framebuffer;return!e||e.handle===null}function vn(t,e){if(!t)return e;let i=Number.parseInt(t,10);return Number.isFinite(i)?i:e}function ue(t,e,i){if(t===e)return!0;if(!i||!t||!e)return!1;if(Array.isArray(t)){if(!Array.isArray(e)||t.length!==e.length)return!1;for(let n=0;n<t.length;n++)if(!ue(t[n],e[n],i-1))return!1;return!0}if(Array.isArray(e))return!1;if(typeof t=="object"&&typeof e=="object"){let n=Object.keys(t),r=Object.keys(e);if(n.length!==r.length)return!1;for(let o of n)if(!e.hasOwnProperty(o)||!ue(t[o],e[o],i-1))return!1;return!0}return!1}var fe=class{bufferLayouts;constructor(e){this.bufferLayouts=e}getBufferLayout(e){return this.bufferLayouts.find(i=>i.name===e)||null}getAttributeNamesForBuffer(e){return me(e)}mergeBufferLayouts(e,i){let n=[...e];for(let r of i){let o=n.findIndex(s=>s.name===r.name);o<0?n.push(r):n[o]=r}return n}};function wn(t,e){let i=li(t),n=e.slice();return n.sort((r,o)=>{let s=lt(me(r).map(u=>i[u])),a=lt(me(o).map(u=>i[u]));return s-a}),n}function le(t,e){if(!t||!e.some(n=>n.bindingLayout?.length))return t;let i={...t,bindings:t.bindings.map(n=>({...n}))};"attributes"in(t||{})&&(i.attributes=t?.attributes||[]);for(let n of e)for(let r of n.bindingLayout||[])for(let o of _s(r.name)){let s=i.bindings.find(a=>a.name===o);s?.group===0&&(s.group=r.group),s&&r.visibility!==void 0&&(s.visibility=r.visibility)}return i}function Ln(t,e,i=[]){return t?e?{...t,attributes:t.attributes.length?vs(t.attributes,e.attributes.filter(n=>i.includes(n.name))):e.attributes,bindings:ys(t.bindings,e.bindings)}:t:e}function Ae(t){return!!(t.uniformTypes&&!bs(t.uniformTypes))}function Sn(t){let e=[];for(let i of t){let n=we(i),r=new Set([i.vs,i.fs].flatMap(s=>s?Le(s).filter(a=>a.isStd140).map(a=>a.blockName):[])),o=r.has(n)?n:r.size===1?r.values().next().value:void 0;Ae(i)&&o&&e.push({name:o,uniformTypes:i.uniformTypes})}return e}function nt(t,e){let i=[],n=new Set;for(let r of[...t||[],...e||[]])n.has(r.name)||(n.add(r.name),i.push(r));return i}function _s(t){let e=new Set([t,`${t}Uniforms`]);return t.endsWith("Uniforms")||e.add(`${t}Sampler`),[...e]}function bs(t){for(let e in t)return!1;return!0}function ys(t,e){let i=t.map(o=>({...o})),n=new Set(t.map(o=>o.name)),r=new Set(t.map(o=>`${o.group}:${o.location}`));for(let o of e){let s=`${o.group}:${o.location}`;!n.has(o.name)&&!r.has(s)&&i.push({...o})}return i}function vs(t,e){let i=t.map(o=>({...o})),n=new Map(t.map(o=>[o.name,o])),r=new Map(t.map(o=>[o.location,o]));for(let o of e){let s=n.get(o.name);if(s){if(s.type!==o.type||s.location!==o.location)throw new Error(`Shader attribute "${o.name}" conflicts with its inferred type or location`);continue}let a=r.get(o.location);if(a)throw new Error(`Shader attributes "${a.name}" and "${o.name}" both use location ${o.location}`);i.push({...o})}return i}function En(t){return ArrayBuffer.isView(t)&&!(t instanceof DataView)}function An(t){return Array.isArray(t)?t.length===0||typeof t[0]=="number":!1}function Be(t){return En(t)||An(t)}function xs(t){return Be(t)||typeof t=="number"||typeof t=="boolean"}function Bn(t,e={}){let i={bindings:{},uniforms:{}};return Object.keys(t).forEach(n=>{let r=t[n];Object.prototype.hasOwnProperty.call(e,n)||xs(r)?i.uniforms[n]=r:i.bindings[n]=r}),i}var ce=class{options={disableWarnings:!1};modules;moduleUniforms;moduleBindings;directBindings={};constructor(e,i){Object.assign(this.options,i);let n=X(Object.values(e).filter(ws));for(let r of n)e[r.name]=r;_.log(1,"Creating ShaderInputs with modules",Object.keys(e))(),this.modules=e,this.moduleUniforms={},this.moduleBindings={};for(let[r,o]of Object.entries(e))o&&(this._addModule(o),o.name&&r!==o.name&&!this.options.disableWarnings&&_.warn(`Module name: ${r} vs ${o.name}`)())}destroy(){}setProps(e){e.bindings&&Object.assign(this.directBindings,e.bindings);for(let i of Object.keys(e)){if(i==="bindings")continue;let n=i,r=e[n]||{},o=this.modules[n];if(!o)this.options.disableWarnings||_.warn(`Module ${i} not found`)();else{let s=this.moduleUniforms[n],a=this.moduleBindings[n],u=o.getUniforms?.(r,s)||r,{uniforms:f,bindings:l}=Bn(u,o.uniformTypes);this.moduleUniforms[n]=In(s,f,o.uniformTypes),this.moduleBindings[n]={...a,...l}}}}getModules(){return Object.values(this.modules)}addModules(e){let i=X(e);for(let n of i){let r=n.name;this.modules[r]||(this.modules[r]=n,this._addModule(n))}}getUniformValues(){return this.moduleUniforms}getBindingValues(){let e={};for(let i of Object.values(this.moduleBindings))Object.assign(e,i);return Object.assign(e,this.directBindings),e}getModuleBindingValues(e){let i=this.moduleBindings[e];return i?{...i}:{}}getDebugTable(){let e={};for(let[i,n]of Object.entries(this.moduleUniforms))for(let[r,o]of Object.entries(n))e[`${i}.${r}`]={type:this.modules[i].uniformTypes?.[r],value:String(o)};return e}_addModule(e){let i=e.name;this.moduleUniforms[i]=In({},e.defaultUniforms||{},e.uniformTypes),this.moduleBindings[i]={}}};function In(t={},e={},i={}){let n={...t};for(let[r,o]of Object.entries(e))o!==void 0&&(n[r]=Dt(t[r],o,i[r]));return n}function Dt(t,e,i){if(!i||typeof i=="string")return Ie(e);if(Array.isArray(i)){if(Ft(e)||!Array.isArray(e))return Ie(e);let s=Array.isArray(t)&&!Ft(t)?[...t]:[],a=s.slice();for(let u=0;u<e.length;u++){let f=e[u];f!==void 0&&(a[u]=Dt(s[u],f,i[0]))}return a}if(!Mt(e))return Ie(e);let n=i,r=Mt(t)?t:{},o={...r};for(let[s,a]of Object.entries(e))a!==void 0&&(o[s]=Dt(r[s],a,n[s]));return o}function Ie(t){return ArrayBuffer.isView(t)?Array.prototype.slice.call(t):Array.isArray(t)?Ft(t)?t.slice():t.map(i=>i===void 0?void 0:Ie(i)):Mt(t)?Object.fromEntries(Object.entries(t).map(([e,i])=>[e,i===void 0?void 0:Ie(i)])):t}function Ft(t){return ArrayBuffer.isView(t)||Array.isArray(t)&&(t.length===0||typeof t[0]=="number")}function Mt(t){return!!t&&typeof t=="object"&&!Array.isArray(t)&&!ArrayBuffer.isView(t)}function ws(t){return!!t?.dependencies}var Ls=A.DEBUG_DATA_MAX_LENGTH,O=class{device;id;ready;usage;props;isReady=!0;destroyed=!1;generation=0;updateTimestamp;debugData=new ArrayBuffer(0);_debugDataEnabled;_maxDebugDataByteLength;_ownsBuffer;_buffer;get buffer(){return this._buffer}get byteLength(){return this._buffer.byteLength}get[Symbol.toStringTag](){return"DynamicBuffer"}toString(){return`DynamicBuffer:"${this.id}":${this.byteLength}B`}toJSON(){return this.toString()}constructor(e,i){let{debugData:n=!1,buffer:r,ownsBuffer:o=!0,...s}=i;if(r&&r.device!==e)throw new Error("DynamicBuffer adopted buffers must belong to the supplied device");if(r&&(s.byteLength!==void 0||s.data!==void 0))throw new Error("DynamicBuffer cannot combine an adopted buffer with byteLength or data");let a=i.id||r?.id||T("dynamic-buffer"),u={...s,id:a,usage:s.usage??r?.usage,indexType:s.indexType??r?.indexType};(u.usage||0)&A.INDEX&&!u.indexType&&(s.data instanceof Uint32Array?u.indexType="uint32":s.data instanceof Uint16Array?u.indexType="uint16":s.data instanceof Uint8Array&&(u.indexType="uint8")),delete u.data,delete u.byteOffset,this.device=e,this.id=a,this.props=u,this.usage=u.usage||0,this._debugDataEnabled=!!n,this._maxDebugDataByteLength=typeof n=="object"&&n.maxByteLength!==void 0?n.maxByteLength:Ls,this._ownsBuffer=o,this._buffer=r??this.device.createBuffer({...s,id:a}),this.ready=Promise.resolve(this._buffer),this.updateTimestamp=this._buffer.updateTimestamp,this._resetDebugData(this._buffer.byteLength),s.data&&this._writeDebugData(s.data,s.byteOffset||0)}write(e,i=0){this._buffer.write(e,i),this._touch(),this._writeDebugData(e,i)}async mapAndWriteAsync(e,i=0,n=this.byteLength-i){let r=null;await this._buffer.mapAndWriteAsync(async(o,s)=>{await e(o,s),r=new Uint8Array(o.slice(0,n))},i,n),this._touch(),r&&this._writeDebugData(r,i)}async readAsync(e=0,i=this.byteLength-e){let n=await this._buffer.readAsync(e,i);return this._writeDebugData(n,e)&&this._touch(),n}async mapAndReadAsync(e,i=0,n=this.byteLength-i){let r=null,o=await this._buffer.mapAndReadAsync(async(s,a)=>(r=new Uint8Array(s.slice(0)),await e(s,a)),i,n);return r&&this._writeDebugData(r,i)&&this._touch(),o}resize(e){let{byteLength:i,preserveData:n=!1}=e;if(i===this.byteLength)return!1;let r=Math.min(e.copyByteLength??Math.min(this.byteLength,i),this.byteLength,i),o=this._buffer,s=this.debugData.slice(0),{data:a,byteOffset:u,...f}=this.props,l=this.device.createBuffer({...f,byteLength:i});return n&&r>0&&this._copyBufferContents(o,l,r),this._buffer=l,this._resetDebugData(i),n&&s.byteLength>0&&this._writeDebugData(s,0),this._ownsBuffer&&o.destroy(),this._ownsBuffer=!0,this.generation++,this._touch(),!0}ensureSize(e,i){return e<=this.byteLength?!1:this.resize({byteLength:e,preserveData:i?.preserveData})}getBinding(e){return e?.offset===void 0&&e?.size===void 0?this._buffer:{buffer:this._buffer,offset:e?.offset,size:e?.size}}destroy(){this.destroyed||(this._ownsBuffer&&this._buffer.destroy(),this.destroyed=!0,this.debugData=new ArrayBuffer(0))}_copyBufferContents(e,i,n){let r=this.device.type==="webgpu"?Math.ceil(n/4)*4:n,o=this.device.createCommandEncoder();o.copyBufferToBuffer({sourceBuffer:e,destinationBuffer:i,size:r}),this.device.submit(o.finish())}_touch(){this.updateTimestamp=this.device.incrementTimestamp()}_resetDebugData(e){if(!this._debugDataEnabled){this.debugData=new ArrayBuffer(0);return}this.debugData=new ArrayBuffer(Math.min(e,this._maxDebugDataByteLength))}_writeDebugData(e,i){if(!this._debugDataEnabled||this.debugData.byteLength===0||i>=this.debugData.byteLength)return!1;let n=ArrayBuffer.isView(e)?new Uint8Array(e.buffer,e.byteOffset,e.byteLength):new Uint8Array(e),r=new Uint8Array(this.debugData),o=Math.min(n.byteLength,r.byteLength-i);return r.set(n.subarray(0,o),i),o>0}};function Gt(t){return t!==null&&typeof t=="object"&&"buffer"in t}function Ss(t){return t instanceof O?t.buffer:t}function Tn(t){return{buffer:Ss(t.buffer),offset:t.offset,size:t.size}}function Te(t){return t!==null&&typeof t=="object"&&"resolveTextureBinding"in t&&typeof t.resolveTextureBinding=="function"}function Es(t){return t?.type==="texture"||t?.type==="external-texture"}function On(t,e,i){let n=ai(t,e,{ignoreWarnings:!0});return Es(n)?n:t.bindings.length===0&&i?.fallbackGroup!==void 0?{type:"texture",name:e,group:i.fallbackGroup,location:0}:null}var M=2,As=1e4,Ut="render pipeline initialization failed",Bs=["stencil8","depth16unorm","depth24plus","depth24plus-stencil8","depth32float","depth32float-stencil8"],j=class t{static defaultProps={...oi.defaultProps,source:void 0,vs:null,fs:null,id:"unnamed",handle:void 0,userData:{},defines:{},modules:[],plugins:[],geometry:null,indexBuffer:null,indexCount:void 0,firstVertex:0,firstIndex:0,attributes:{},constantAttributes:{},bindings:{},uniforms:{},varyings:[],isInstanced:void 0,instanceCount:0,vertexCount:0,shaderInputs:void 0,material:void 0,pipelineFactory:void 0,shaderFactory:void 0,transformFeedback:void 0,shaderAssembler:F.getDefaultShaderAssembler("glsl"),debugShaders:void 0,disableWarnings:void 0};device;id;source;vs;fs;pipelineFactory;shaderFactory;userData={};parameters;topology;bufferLayout;isInstanced=void 0;instanceCount=0;vertexCount;indexCount;firstVertex;firstIndex;indexBuffer=null;bufferAttributes={};constantAttributes={};bindings={};vertexArray;transformFeedback=null;pipeline;shaderInputs;material=null;_uniformStore;_attributeInfos={};_gpuGeometry=null;props;_dynamicIndexBufferSource=null;_dynamicAttributeBufferSources={};_colorAttachmentFormats;_depthStencilAttachmentFormat;_pipelineNeedsUpdate="newly created";_needsRedraw="initializing";_drawBlockedReason=!1;_destroyed=!1;_vertexCountSet=!1;_lastDrawTimestamp=-1;_bindingTable=[];get[Symbol.toStringTag](){return"Model"}toString(){return`Model(${this.id})`}constructor(e,i){let n=t.defaultProps.shaderAssembler,r=i.vertexCount!==void 0;this.props={...t.defaultProps,...i,shaderAssembler:i.shaderAssembler??($t(n,e.info.shadingLanguage)?n:F.getDefaultShaderAssembler(e.info.shadingLanguage))},this._vertexCountSet=r,i=this.props,this.id=i.id||T("model"),this.device=e,Object.assign(this.userData,i.userData),this.material=i.material||null;let o=Cs(e),s=ve(this.props.plugins,o.shaderLanguage),a=xe(this.props.modules,s.modules),u=Object.fromEntries(a.map(c=>[c.name,c])),f=i.shaderInputs||new ce(u,{disableWarnings:this.props.disableWarnings});i.shaderInputs&&s.modules.length>0&&f.addModules(s.modules),this.setShaderInputs(f);let l=nt(this.props.modules,f.getModules()),d={...s.defines,...this.props.defines};if(this.device.type==="webgl"&&(this.props._uniformBlockLayouts=Sn(l)),this.props.shaderLayout=le(this.props.shaderLayout,l)||null,this.device.type==="webgpu"&&this.props.source){let c=this.props.shaderAssembler;ge($t(c,"wgsl"));let{source:p,getUniforms:g,bindingTable:m,shaderLayout:v}=c.assembleWGSLShader({platformInfo:o,...this.props,modules:l,defines:d,pluginInjections:s.injections,pluginVertexInputs:s.vertexInputs,pluginVaryings:s.varyings});this.source=p,this._getModuleUniforms=g,this._bindingTable=m;let b=v??e.getShaderLayout?.(this.source),N=Is(b,s.vertexInputs),x=Ln(this.props.shaderLayout,N,Object.keys(s.vertexInputs));this.props.shaderLayout=le(x||null,l)||null}else{let c=this.props.shaderAssembler;ge($t(c,"glsl"));let{vs:p,fs:g,getUniforms:m}=c.assembleGLSLShaderPair({platformInfo:o,...this.props,modules:l,defines:d,pluginInjections:s.injections,pluginVertexInputs:s.vertexInputs,pluginVaryings:s.varyings});this.vs=p,this.fs=g,this._getModuleUniforms=m,this._bindingTable=[]}this.vertexCount=this.props.vertexCount,this.indexCount=this.props.indexCount,this.firstVertex=this.props.firstVertex,this.firstIndex=this.props.firstIndex,this.instanceCount=this.props.instanceCount,this.topology=this.props.topology,this.bufferLayout=this.props.bufferLayout,this.parameters=this.props.parameters,this._colorAttachmentFormats=this.props.colorAttachmentFormats,this._depthStencilAttachmentFormat=this.props.depthStencilAttachmentFormat,i.geometry&&this.setGeometry(i.geometry),this.pipelineFactory=i.pipelineFactory||Ce.getDefaultPipelineFactory(this.device),this.shaderFactory=i.shaderFactory||Ne.getDefaultShaderFactory(this.device),this.pipeline=this._updatePipeline(),this.vertexArray=e.createVertexArray({shaderLayout:this.pipeline.shaderLayout,bufferLayout:this.pipeline.bufferLayout}),this._gpuGeometry&&this._setGeometryAttributes(this._gpuGeometry),"isInstanced"in i&&(this.isInstanced=i.isInstanced),i.instanceCount&&this.setInstanceCount(i.instanceCount),i.vertexCount&&this.setVertexCount(i.vertexCount),i.indexBuffer&&this.setIndexBuffer(i.indexBuffer),i.attributes&&this.setAttributes(i.attributes),i.constantAttributes&&this.setConstantAttributes(i.constantAttributes),i.bindings&&this.setBindings(i.bindings),i.transformFeedback&&(this.transformFeedback=i.transformFeedback)}destroy(){this._destroyed||(this.pipelineFactory.release(this.pipeline),this.shaderFactory.release(this.pipeline.vs),this.pipeline.fs&&this.pipeline.fs!==this.pipeline.vs&&this.shaderFactory.release(this.pipeline.fs),this._uniformStore.destroy(),this._gpuGeometry?.destroy(),this._destroyed=!0)}needsRedraw(){this._getBindingsUpdateTimestamp()>this._lastDrawTimestamp&&this.setNeedsRedraw("contents of bound textures or buffers updated");let e=this._needsRedraw;return this._needsRedraw=!1,e}setNeedsRedraw(e){this._needsRedraw||=e}getBindingDebugTable(){return this._bindingTable}predraw(e){this._syncDynamicBuffers(),this.updateShaderInputs(e),this.material?.updateShaderInputs(e),this.pipeline=this._updatePipeline()}draw(e){if(this._drawBlockedReason&&!this._pipelineNeedsUpdate)return _.info(M,`>>> DRAWING ABORTED ${this.id}: ${this._drawBlockedReason}`)(),!1;let i=this._areBindingsLoading();if(i)return _.info(M,`>>> DRAWING ABORTED ${this.id}: ${i} not loaded`)(),!1;this._syncAttachmentFormats(e);try{e.pushDebugGroup(`${this}.predraw(${e})`),this.device.type==="webgpu"?(this.updateShaderInputs(),this.material?.updateShaderInputs(),this._syncDynamicBuffers(),this.pipeline=this._updatePipeline()):this.predraw(this.device.commandEncoder)}finally{e.popDebugGroup()}let n,r=this.pipeline.isErrored;try{if(e.pushDebugGroup(`${this}.draw(${e})`),this._logDrawCallStart(),this.pipeline=this._updatePipeline(),r=this.pipeline.isErrored,r)_.info(M,`>>> DRAWING ABORTED ${this.id}: ${Ut}`)(),n=!1;else{let o=this.vertexArray.getDrawValidationError();if(o)_.info(M,`>>> DRAWING ABORTED ${this.id}: ${o}`)(),this._drawBlockedReason=o,n=!1;else{let s=this._getCurrentShaderLayout(),a=this._getBindings(s),u=this._getBindGroups(s,a),{indexBuffer:f}=this.vertexArray,l=f?this.indexCount??(this._vertexCountSet?this.vertexCount:f.byteLength/(f.indexType==="uint32"?4:2)):void 0;e.setPipeline(this.pipeline),e.setBindings(u,{_bindGroupCacheKeys:this._getBindGroupCacheKeys()}),e.setVertexArray(this.vertexArray),n=this.isInstanced===!0&&this.instanceCount===0?!0:e.draw({isInstanced:this.isInstanced,vertexCount:this.vertexCount,instanceCount:this.isInstanced?this.instanceCount:void 0,indexCount:l,firstVertex:this.firstVertex,firstIndex:this.firstIndex,transformFeedback:this.transformFeedback||void 0,uniforms:this.props.uniforms,parameters:this.parameters,topology:this.topology})}}}finally{e.popDebugGroup(),this._logDrawCallEnd()}return this._logFramebuffer(e),n?(this._lastDrawTimestamp=this.device.timestamp,this._needsRedraw=!1):r?(this._needsRedraw=Ut,this._drawBlockedReason=Ut):this._drawBlockedReason?this._needsRedraw=this._drawBlockedReason:this._needsRedraw="waiting for resource initialization",n}setGeometry(e){this._gpuGeometry?.destroy();let i=e&&_n(this.device,e);if(i){this.setTopology(i.topology||"triangle-list");let n=new fe(this.bufferLayout);this.bufferLayout=n.mergeBufferLayouts(i.bufferLayout,this.bufferLayout),this.vertexArray&&this._setGeometryAttributes(i)}this._gpuGeometry=i}setTopology(e){e!==this.topology&&(this.topology=e,this._setPipelineNeedsUpdate("topology"))}setBufferLayout(e){let i=new fe(this.bufferLayout),n=this._gpuGeometry?i.mergeBufferLayouts(e,this._gpuGeometry.bufferLayout):e;ue(n,this.bufferLayout,-1)||(this.bufferLayout=n,this._setPipelineNeedsUpdate("bufferLayout"),this.pipeline=this._updatePipeline(),this.vertexArray=this.device.createVertexArray({shaderLayout:this.pipeline.shaderLayout,bufferLayout:this.pipeline.bufferLayout}),this._gpuGeometry&&this._setGeometryAttributes(this._gpuGeometry))}setParameters(e){ue(e,this.parameters,2)||(this.parameters=e,this._setPipelineNeedsUpdate("parameters"))}setInstanceCount(e){this.instanceCount=e,this.isInstanced===void 0&&e>0&&(this.isInstanced=!0),this.setNeedsRedraw("instanceCount")}setVertexCount(e){this.vertexCount=e,this._vertexCountSet=!0,this.setNeedsRedraw("vertexCount")}setIndexCount(e){this.indexCount=e,this.setNeedsRedraw("indexCount")}setDrawOffsets({firstVertex:e,firstIndex:i}){this.firstVertex=e,this.firstIndex=i,this.setNeedsRedraw("drawOffsets")}setShaderInputs(e){this.shaderInputs=e,this._uniformStore=new Re(this.device,this.shaderInputs.modules);for(let[i,n]of Object.entries(this.shaderInputs.modules))if(Ae(n)&&!this.material?.ownsModule(i)){let r=this._uniformStore.getManagedUniformBuffer(i);this.bindings[`${i}Uniforms`]=r}this.setNeedsRedraw("shaderInputs")}setMaterial(e){this.material=e,this.setNeedsRedraw("material")}updateShaderInputs(e){this._uniformStore.setUniforms(this.shaderInputs.getUniformValues(),e),this.setBindings(this._getNonMaterialBindings(this.shaderInputs.getBindingValues())),this.setNeedsRedraw("shaderInputs")}setBindings(e){Object.assign(this.bindings,e),this.setNeedsRedraw("bindings")}setTransformFeedback(e){this.transformFeedback=e,this.setNeedsRedraw("transformFeedback")}setIndexBuffer(e){let i=e instanceof O?e.buffer:e;this.indexBuffer=i,this._dynamicIndexBufferSource=e instanceof O?{source:e,generation:e.generation}:null,this.vertexArray.setIndexBuffer(i),this.setNeedsRedraw("indexBuffer")}setAttributes(e,i){this._drawBlockedReason=!1;let n=i?.disableWarnings??this.props.disableWarnings;e.indices&&_.warn(`Model:${this.id} setAttributes() - indexBuffer should be set using setIndexBuffer()`)(),this.bufferLayout=wn(this.pipeline.shaderLayout,this.bufferLayout);let r=new fe(this.bufferLayout);for(let[o,s]of Object.entries(e)){let a=s instanceof O?s.buffer:s,u=r.getBufferLayout(o);if(!u){n||_.warn(`Model(${this.id}): Missing layout for buffer "${o}".`)();continue}let f=r.getAttributeNamesForBuffer(u),l=!1;for(let d of f){let h=this._attributeInfos[d];if(h){let c=this.device.type==="webgpu"?this.vertexArray.getBufferSlot(h.bufferName):h.location;if(c===null){n||_.warn(`Model(${this.id}): Missing vertex array slot for buffer "${h.bufferName}".`)();continue}this.vertexArray.setBuffer(c,a),s instanceof O?this._dynamicAttributeBufferSources[c]={source:s,generation:s.generation}:delete this._dynamicAttributeBufferSources[c],l=!0}}!l&&!n&&_.warn(`Model(${this.id}): Ignoring buffer "${a.id}" for unknown attribute "${o}"`)()}this.setNeedsRedraw("attributes")}setConstantAttributes(e,i){for(let[n,r]of Object.entries(e)){let o=this._attributeInfos[n];o?this.vertexArray.setConstantWebGL(o.location,r):(i?.disableWarnings??this.props.disableWarnings)||_.warn(`Model "${this.id}: Ignoring constant supplied for unknown attribute "${n}"`)()}this.setNeedsRedraw("constants")}_areBindingsLoading(){for(let e of Object.values(this.bindings))if(Te(e)&&!e.isReady)return e.id;for(let e of Object.values(this.material?.bindings||{}))if(Te(e)&&!e.isReady)return e.id;return!1}_getBindings(e=this._getCurrentShaderLayout()){let i={};for(let[n,r]of Object.entries(this.bindings)){let o=Ts(n,r,e);o&&(i[n]=o)}return i}_getBindGroups(e=this._getCurrentShaderLayout(),i=this._getBindings(e)){let n=e.bindings.length?ui(e,i):{0:i};if(!this.material)return n;for(let[r,o]of Object.entries(this.material.getBindingsByGroup(e))){let s=Number(r);n[s]={...n[s]||{},...o}}return n}_getBindGroupCacheKeys(){let e=this.material?.getBindGroupCacheKey(3);return e?{3:e}:{}}_getBindingsUpdateTimestamp(){let e=0;this._dynamicIndexBufferSource&&(e=Math.max(e,this._dynamicIndexBufferSource.source.updateTimestamp));for(let i of Object.values(this._dynamicAttributeBufferSources))e=Math.max(e,i.source.updateTimestamp);for(let i of Object.values(this.bindings))i instanceof ni?e=Math.max(e,i.texture.updateTimestamp):i instanceof A||i instanceof ii||i instanceof ri||i instanceof O?e=Math.max(e,i.updateTimestamp):Te(i)?e=i.isReady?Math.max(e,i.updateTimestamp):1/0:Gt(i)&&(e=Math.max(e,(i.buffer instanceof O,i.buffer.updateTimestamp)));return Math.max(e,this.material?.getBindingsUpdateTimestamp()||0)}_setGeometryAttributes(e){let i={...e.attributes};for(let[n]of Object.entries(i))!this.pipeline.shaderLayout.attributes.find(r=>r.name===n)&&n!=="positions"&&delete i[n];this.vertexCount=e.vertexCount,this._vertexCountSet=!0,this.setIndexBuffer(e.indices||null),this.setAttributes(e.attributes,{disableWarnings:!0}),this.setAttributes(i,{disableWarnings:this.props.disableWarnings}),this.setNeedsRedraw("geometry attributes")}_setPipelineNeedsUpdate(e){this._pipelineNeedsUpdate||=e,this._drawBlockedReason=!1,this.setNeedsRedraw(e)}_updatePipeline(){if(this._pipelineNeedsUpdate){let e=null,i=null;this.pipeline&&(_.log(1,`Model ${this.id}: Recreating pipeline because "${this._pipelineNeedsUpdate}".`)(),e=this.pipeline.vs,i=this.pipeline.fs),this._pipelineNeedsUpdate=!1;let n=this.shaderFactory.createShader({id:`${this.id}-vertex`,stage:"vertex",source:this.source||this.vs,debugShaders:this.props.debugShaders}),r=null;this.source?r=n:this.fs&&(r=this.shaderFactory.createShader({id:`${this.id}-fragment`,stage:"fragment",source:this.source||this.fs,debugShaders:this.props.debugShaders})),this.pipeline=this.pipelineFactory.createRenderPipeline({...this.props,bindings:void 0,bufferLayout:this.bufferLayout,colorAttachmentFormats:this._colorAttachmentFormats,depthStencilAttachmentFormat:this._depthStencilAttachmentFormat,topology:this.topology,parameters:this.parameters,bindGroups:void 0,vs:n,fs:r}),this._attributeInfos=ci(this.pipeline.shaderLayout,this.bufferLayout),e&&this.shaderFactory.release(e),i&&i!==e&&this.shaderFactory.release(i)}return this.pipeline}_lastLogTime=0;_logOpen=!1;_logDrawCallStart(){let e=_.level>3?0:As;_.level<2||Date.now()-this._lastLogTime<e||(this._lastLogTime=Date.now(),this._logOpen=!0,_.group(M,`>>> DRAWING MODEL ${this.id}`,{collapsed:_.level<=2})())}_logDrawCallEnd(){if(this._logOpen){let e=bn(this.pipeline.shaderLayout,this.id);_.table(M,e)();let i=this.shaderInputs.getDebugTable();_.table(M,i)();let n=this._getAttributeDebugTable();_.table(M,this._attributeInfos)(),_.table(M,n)(),_.groupEnd(M)(),this._logOpen=!1}}_drawCount=0;_logFramebuffer(e){let i=this.device.props.debugFramebuffers;if(this._drawCount++,!i)return;let n=e.props.framebuffer;xn(e,n,{id:n?.id||`${this.id}-framebuffer`,minimap:!0})}_getAttributeDebugTable(){let e={};for(let[i,n]of Object.entries(this._attributeInfos)){let r=this.vertexArray.attributes[n.location];e[n.location]={name:i,type:n.shaderType,values:r?this._getBufferOrConstantValues(r,n.bufferDataType):"null"}}if(this.vertexArray.indexBuffer){let{indexBuffer:i}=this.vertexArray,n=i.indexType==="uint32"?new Uint32Array(i.debugData):new Uint16Array(i.debugData);e.indices={name:"indices",type:i.indexType,values:n.toString()}}return e}_getBufferOrConstantValues(e,i){let n=Pe.getTypedArrayConstructor(i);return(e instanceof A?new n(e.debugData):e).toString()}_getNonMaterialBindings(e){if(!this.material)return e;let i={};for(let[n,r]of Object.entries(e))this.material.ownsBinding(n)||(i[n]=r);return i}_getCurrentShaderLayout(){return this.pipeline?.shaderLayout||this.props.shaderLayout||{bindings:[]}}_syncDynamicBuffers(){if(this._dynamicIndexBufferSource&&this._dynamicIndexBufferSource.generation!==this._dynamicIndexBufferSource.source.generation){let e=this._dynamicIndexBufferSource.source.buffer;this.indexBuffer=e,this.vertexArray.setIndexBuffer(e),this._dynamicIndexBufferSource.generation=this._dynamicIndexBufferSource.source.generation,this.setNeedsRedraw("dynamic index buffer")}for(let[e,i]of Object.entries(this._dynamicAttributeBufferSources))i.generation!==i.source.generation&&(this.vertexArray.setBuffer(Number(e),i.source.buffer),i.generation=i.source.generation,this.setNeedsRedraw("dynamic attribute buffer"))}_syncAttachmentFormats(e){if(this.device.type!=="webgpu")return;let i=e.framebuffer||e.props.framebuffer,n=e.props,r=n.colorAttachmentFormats??i?.colorAttachments?.map(s=>Os(s?.texture?.format)),o=n.depthStencilAttachmentFormat===!1?void 0:n.depthStencilAttachmentFormat??Ps(i?.depthStencilAttachment?.texture?.format);(!ue(this._colorAttachmentFormats,r,1)||this._depthStencilAttachmentFormat!==o)&&(this._colorAttachmentFormats=r,this._depthStencilAttachmentFormat=o,this._setPipelineNeedsUpdate("attachment formats"))}};function $t(t,e){return t.shaderLanguage!==void 0&&t.shaderLanguage!==e?!1:e==="glsl"?"assembleGLSLShaderPair"in t&&typeof t.assembleGLSLShaderPair=="function":"assembleWGSLShader"in t&&typeof t.assembleWGSLShader=="function"}function Is(t,e){return!t||Object.keys(e).length===0?t:{...t,attributes:t.attributes.map(i=>{let n=i.name.startsWith("_luma_")?i.name.slice(6):null;return n&&e[n]?{...i,name:n}:i})}}function Ts(t,e,i){if(Te(e)){let n=On(i,t,{fallbackGroup:0});return n?e.resolveTextureBinding(n):null}return e instanceof O?e.buffer:Gt(e)?Tn(e):e}function Os(t){return t&&!Pn(t)?t:null}function Ps(t){return t&&Pn(t)?t:void 0}function Pn(t){return Bs.includes(t)}function Cs(t){return{type:t.type,shaderLanguage:t.info.shadingLanguage,shaderLanguageVersion:t.info.shadingLanguageVersion,gpu:t.info.gpu,limits:t.limits,features:t.features}}var Ns=35980,Rs=35981,kt=class t{device;model;transformFeedback;static defaultProps={...j.defaultProps,feedbackBufferMode:"separate",outputs:void 0,feedbackBuffers:void 0};static isSupported(e){return e?.info?.type==="webgl"}constructor(e,i=t.defaultProps){if(!t.isSupported(e))throw new Error("BufferTransform not yet implemented on WebGPU");this.device=e,this.model=new j(this.device,{id:i.id||"buffer-transform-model",fs:i.fs||Ee(),topology:i.topology||"point-list",varyings:i.outputs||i.varyings,...i,bufferMode:i.bufferMode||(i.feedbackBufferMode==="interleaved"?Ns:Rs)}),this.transformFeedback=this.device.createTransformFeedback({layout:this.model.pipeline.shaderLayout,buffers:i.feedbackBuffers}),this.model.setTransformFeedback(this.transformFeedback)}destroy(){this.model&&this.model.destroy()}delete(){this.destroy()}run(e){e?.inputBuffers&&this.model.setAttributes(e.inputBuffers),e?.outputBuffers&&this.transformFeedback.setBuffers(e.outputBuffers);let i=this.device.beginRenderPass({discard:!0,...e});this.model.draw(i),i.end()}getBuffer(e){return this.transformFeedback.getBuffer(e)}readAsync(e){let i=this.getBuffer(e);if(!i)throw new Error("BufferTransform#getBuffer");if(i instanceof A)return i.readAsync();let{buffer:n,byteOffset:r=0,byteLength:o=n.byteLength}=i;return n.readAsync(r,o)}};var zt=2,Ds=1e4,Vt=class t{static defaultProps={...si.defaultProps,id:"unnamed",handle:void 0,userData:{},source:"",modules:[],defines:{},plugins:[],bindings:void 0,shaderInputs:void 0,pipelineFactory:void 0,shaderFactory:void 0,shaderAssembler:F.getDefaultShaderAssembler("wgsl"),debugShaders:void 0};device;id;pipelineFactory;shaderFactory;userData={};bindings={};pipeline;source;shader;shaderInputs;_uniformStore;_pipelineNeedsUpdate="newly created";_getModuleUniforms;props;_destroyed=!1;constructor(e,i){if(e.type!=="webgpu")throw new Error("Computation is only supported in WebGPU");this.props={...t.defaultProps,...i},i=this.props,this.id=i.id||T("model"),this.device=e,Object.assign(this.userData,i.userData);let n=Fs(e),r=ve(this.props.plugins,n.shaderLanguage);if(Object.keys(r.vertexInputs).length>0||Object.keys(r.varyings).length>0)throw new Error("Computation does not support ShaderPlugin vertex inputs or varyings");let o=xe(this.props.modules,r.modules),s=Object.fromEntries(o.map(p=>[p.name,p]));this.shaderInputs=i.shaderInputs||new ce(s),i.shaderInputs&&r.modules.length>0&&this.shaderInputs.addModules(r.modules),this.setShaderInputs(this.shaderInputs);let a=nt(this.props.modules,this.shaderInputs?.getModules()),u={...r.defines,...this.props.defines};this.props.shaderLayout=le(this.props.shaderLayout,a)||null,this.pipelineFactory=i.pipelineFactory||Ce.getDefaultPipelineFactory(this.device),this.shaderFactory=i.shaderFactory||Ne.getDefaultShaderFactory(this.device);let f=this.props.shaderAssembler;ge(f instanceof ae);let{source:l,getUniforms:d,shaderLayout:h}=f.assembleWGSLShader({platformInfo:n,...this.props,modules:a,defines:u,scanVertexAttributes:!1,pluginInjections:r.injections});this.source=l,this._getModuleUniforms=d;let c=h??e.getShaderLayout?.(this.source,{scanVertexAttributes:!1});this.props.shaderLayout=le(this.props.shaderLayout||c||null,a)||null,this.pipeline=this._updatePipeline(),i.bindings&&this.setBindings(i.bindings)}destroy(){this._destroyed||(this.pipelineFactory.release(this.pipeline),this.shaderFactory.release(this.shader),this._uniformStore.destroy(),this._destroyed=!0)}predraw(e){this.updateShaderInputs(e)}dispatch(e,i,n,r){try{this._logDrawCallStart(),this._setPipeline(e),e.dispatch(i,n,r)}finally{this._logDrawCallEnd()}}dispatchIndirect(e,i,n=0){try{this._logDrawCallStart(),this._setPipeline(e),e.dispatchIndirect(i,n)}finally{this._logDrawCallEnd()}}_setPipeline(e){this.pipeline=this._updatePipeline(),this.pipeline.setBindings(this.bindings),e.setPipeline(this.pipeline),e.setBindings({})}setVertexCount(e){}setInstanceCount(e){}setShaderInputs(e){this.shaderInputs=e,this._uniformStore=new Re(this.device,this.shaderInputs.modules);for(let[i,n]of Object.entries(this.shaderInputs.modules))if(Ae(n)){let r=this._uniformStore.getManagedUniformBuffer(i);this.bindings[`${i}Uniforms`]=r}}setShaderModuleProps(e){let i=this._getModuleUniforms(e),n=Object.keys(i).filter(o=>{let s=i[o];return!Be(s)&&typeof s!="number"&&typeof s!="boolean"}),r={};for(let o of n)r[o]=i[o],delete i[o]}updateShaderInputs(e){this._uniformStore.setUniforms(this.shaderInputs.getUniformValues(),e)}setBindings(e){Object.assign(this.bindings,e)}_setPipelineNeedsUpdate(e){this._pipelineNeedsUpdate=this._pipelineNeedsUpdate||e}_updatePipeline(){if(this._pipelineNeedsUpdate){let e=null;this.pipeline&&(_.log(1,`Model ${this.id}: Recreating pipeline because "${this._pipelineNeedsUpdate}".`)(),e=this.shader),this._pipelineNeedsUpdate=!1,this.shader=this.shaderFactory.createShader({id:`${this.id}-fragment`,stage:"compute",source:this.source,debugShaders:this.props.debugShaders}),this.pipeline=this.pipelineFactory.createComputePipeline({...this.props,shader:this.shader}),e&&this.shaderFactory.release(e)}return this.pipeline}_lastLogTime=0;_logOpen=!1;_logDrawCallStart(){let e=_.level>3?0:Ds;_.level<2||Date.now()-this._lastLogTime<e||(this._lastLogTime=Date.now(),this._logOpen=!0,_.group(zt,`>>> DRAWING MODEL ${this.id}`,{collapsed:_.level<=2})())}_logDrawCallEnd(){if(this._logOpen){let e=this.shaderInputs.getDebugTable();_.table(zt,e)(),_.groupEnd(zt)(),this._logOpen=!1}}_drawCount=0;_getBufferOrConstantValues(e,i){let n=Pe.getTypedArrayConstructor(i);return(e instanceof A?new n(e.debugData):e).toString()}};function Fs(t){return{type:t.type,shaderLanguage:t.info.shadingLanguage,shaderLanguageVersion:t.info.shadingLanguageVersion,gpu:t.info.gpu,limits:t.limits,features:t.features}}var Ms=1,Gs=1,Wt=class{time=0;channels=new Map;animations=new Map;playing=!1;lastEngineTime=-1;constructor(){}addChannel(e){let{delay:i=0,duration:n=Number.POSITIVE_INFINITY,rate:r=1,repeat:o=1}=e,s=Ms++,a={time:0,delay:i,duration:n,rate:r,repeat:o};return this._setChannelTime(a,this.time),this.channels.set(s,a),s}removeChannel(e){this.channels.delete(e);for(let[i,n]of this.animations)n.channel===e&&this.detachAnimation(i)}isFinished(e){let i=this.channels.get(e);return i===void 0?!1:this.time>=i.delay+i.duration*i.repeat}getTime(e){if(e===void 0)return this.time;let i=this.channels.get(e);return i===void 0?-1:i.time}setTime(e){this.time=Math.max(0,e);let i=this.channels.values();for(let r of i)this._setChannelTime(r,this.time);let n=this.animations.values();for(let r of n){let{animation:o,channel:s}=r;o.setTime(this.getTime(s))}}play(){this.playing=!0}pause(){this.playing=!1,this.lastEngineTime=-1}reset(){this.setTime(0)}attachAnimation(e,i){let n=Gs++;return this.animations.set(n,{animation:e,channel:i}),e.setTime(this.getTime(i)),n}detachAnimation(e){this.animations.delete(e)}update(e){this.playing&&(this.lastEngineTime===-1&&(this.lastEngineTime=e),this.setTime(this.time+(e-this.lastEngineTime)),this.lastEngineTime=e)}_setChannelTime(e,i){let n=i-e.delay,r=e.duration*e.repeat;n>=r?e.time=e.duration*e.rate:(e.time=Math.max(0,n)%e.duration,e.time*=e.rate)}};function Cn(t){let e=typeof window<"u"?window.requestAnimationFrame||window.webkitRequestAnimationFrame||window.mozRequestAnimationFrame:null;return e?e.call(window,t):setTimeout(()=>t(typeof performance<"u"?performance.now():Date.now()),1e3/60)}function Nn(t){let e=typeof window<"u"?window.cancelAnimationFrame||window.webkitCancelAnimationFrame||window.mozCancelAnimationFrame:null;if(e){e.call(window,t);return}clearTimeout(t)}var Us=0,$s="Animation Loop",Rn={requestAnimationFrame:t=>Cn(t),cancelAnimationFrame:t=>Nn(t)},jt=class t{static defaultAnimationLoopProps={device:null,onAddHTML:()=>"",onInitialize:async()=>null,onRender:()=>{},onFinalize:()=>{},onError:e=>{console.error(e)},stats:void 0,autoResizeViewport:!1,animationFrameProvider:Rn};device=null;canvas=null;props;animationProps=null;timeline=null;stats;sharedStats;cpuTime;gpuTime;frameRate;display;_needsRedraw="initialized";_initialized=!1;_running=!1;_animationFrameId=null;_nextFramePromise=null;_resolveNextFrame=null;_cpuStartTime=0;_error=null;_lastFrameTime=0;constructor(e){if(this.props={...t.defaultAnimationLoopProps,...e},e=this.props,!e.device)throw new Error("No device provided");this.stats=e.stats||new Qt({id:`animation-loop-${Us++}`}),this.sharedStats=ei.stats.get($s),this.frameRate=this.stats.get("Frame Rate"),this.frameRate.setSampleSize(1),this.cpuTime=this.stats.get("CPU Time"),this.gpuTime=this.stats.get("GPU Time"),this.setProps({autoResizeViewport:e.autoResizeViewport,animationFrameProvider:e.animationFrameProvider}),this.start=this.start.bind(this),this.stop=this.stop.bind(this),this._onMousemove=this._onMousemove.bind(this),this._onMouseleave=this._onMouseleave.bind(this)}destroy(){this.stop(),this._setDisplay(null),this.device?._disableDebugGPUTime()}delete(){this.destroy()}reportError(e){this._error=e,this.props.onError(e),this.props.onError===t.defaultAnimationLoopProps.onError&&typeof window<"u"&&typeof ErrorEvent<"u"&&window.dispatchEvent(new ErrorEvent("error",{error:e,message:e.message}))}setNeedsRedraw(e){return this._needsRedraw=this._needsRedraw||e,this}needsRedraw(){let e=this._needsRedraw;return this._needsRedraw=!1,e}setProps(e){if("autoResizeViewport"in e&&(this.props.autoResizeViewport=e.autoResizeViewport||!1),"animationFrameProvider"in e){let i=e.animationFrameProvider||Rn;if(i!==this.props.animationFrameProvider){let n=this._animationFrameId!==null;n&&this._cancelAnimationFrame(),this.props.animationFrameProvider=i,n&&this._requestAnimationFrame()}}return this}async start(){if(this._running)return this;this._running=!0;try{let e;if(!this._initialized){if(this._initialized=!0,await this._initDevice(),this._initialize(),!this._running)return null;await this.props.onInitialize(this._getAnimationProps())}return this._running?(e!==!1&&(this._cancelAnimationFrame(),this._requestAnimationFrame()),this):null}catch(e){let i=e instanceof Error?e:new Error("Unknown error");throw this.props.onError(i),i}}stop(){if(this._running){let e=this.animationProps;this._cancelAnimationFrame(),this._nextFramePromise=null,this._resolveNextFrame=null,this._running=!1,this._lastFrameTime=0,e&&this.props.onFinalize(e)}return this}redraw(e,i=null){return this.device?.isLost||this._error?this:(this._beginFrameTimers(e),this._setupFrame(),this.animationProps&&(this.animationProps.animationFrame=i),this._updateAnimationProps(),this._renderFrame(this._getAnimationProps()),this._clearNeedsRedraw(),this._resolveNextFrame&&(this._resolveNextFrame(this),this._nextFramePromise=null,this._resolveNextFrame=null),this._endFrameTimers(),this)}attachTimeline(e){return this.timeline=e,this.timeline}detachTimeline(){this.timeline=null}waitForRender(){return this.setNeedsRedraw("waitForRender"),this._nextFramePromise||(this._nextFramePromise=new Promise(e=>{this._resolveNextFrame=e})),this._nextFramePromise}async toDataURL(){if(this.setNeedsRedraw("toDataURL"),await this.waitForRender(),this.canvas instanceof HTMLCanvasElement)return this.canvas.toDataURL();throw new Error("OffscreenCanvas")}_initialize(){this._startEventHandling(),this._initializeAnimationProps(),this._updateAnimationProps(),this._resizeViewport(),this.device?._enableDebugGPUTime()}_setDisplay(e){this.display&&(this.display.destroy(),this.display.animationLoop=null),e&&(e.animationLoop=this),this.display=e}_requestAnimationFrame(){this._running&&(this._animationFrameId=this.props.animationFrameProvider.requestAnimationFrame(this._animationFrame.bind(this)))}_cancelAnimationFrame(){this._animationFrameId!==null&&(this.props.animationFrameProvider.cancelAnimationFrame(this._animationFrameId),this._animationFrameId=null)}_animationFrame(e,i){if(this._running)try{this.redraw(e,i??null),this._requestAnimationFrame()}catch(n){let r=n instanceof Error?n:new Error(String(n));this.reportError(r),this.stop()}}_renderFrame(e){if(this.display){this.display._renderFrame(e);return}let i=this.props.onRender(this._getAnimationProps());this.device&&i!==!1&&this.device.submit()}_clearNeedsRedraw(){this._needsRedraw=!1}_setupFrame(){this._resizeViewport()}_initializeAnimationProps(){let e=this.device?.getDefaultCanvasContext();if(!this.device||!e)throw new Error("loop");let i=e?.canvas,n=e.props.useDevicePixels;this.animationProps={animationLoop:this,device:this.device,canvasContext:e,canvas:i,useDevicePixels:n,timeline:this.timeline,needsRedraw:!1,width:1,height:1,aspect:1,time:0,startTime:Date.now(),engineTime:0,tick:0,tock:0,animationFrame:null,_mousePosition:null}}_getAnimationProps(){if(!this.animationProps)throw new Error("animationProps");return this.animationProps}_updateAnimationProps(){if(!this.animationProps)return;let{width:e,height:i,aspect:n}=this._getSizeAndAspect();(e!==this.animationProps.width||i!==this.animationProps.height)&&this.setNeedsRedraw("drawing buffer resized"),n!==this.animationProps.aspect&&this.setNeedsRedraw("drawing buffer aspect changed"),this.animationProps.width=e,this.animationProps.height=i,this.animationProps.aspect=n,this.animationProps.needsRedraw=this._needsRedraw,this.animationProps.engineTime=Date.now()-this.animationProps.startTime,this.timeline&&this.timeline.update(this.animationProps.engineTime),this.animationProps.tick=Math.floor(this.animationProps.time/1e3*60),this.animationProps.tock++,this.animationProps.time=this.timeline?this.timeline.getTime():this.animationProps.engineTime}async _initDevice(){if(this.device=await this.props.device,!this.device)throw new Error("No device provided");this.canvas=this.device.getDefaultCanvasContext().canvas||null}_createInfoDiv(){if(this.canvas&&this.props.onAddHTML){let e=document.createElement("div");document.body.appendChild(e),e.style.position="relative";let i=document.createElement("div");i.style.position="absolute",i.style.left="10px",i.style.bottom="10px",i.style.width="300px",i.style.background="white",this.canvas instanceof HTMLCanvasElement&&e.appendChild(this.canvas),e.appendChild(i);let n=this.props.onAddHTML(i);n&&(i.innerHTML=n)}}_getSizeAndAspect(){if(!this.device)return{width:1,height:1,aspect:1};let[e,i]=this.device.getDefaultCanvasContext().getDrawingBufferSize(),n=e>0&&i>0?e/i:1;return{width:e,height:i,aspect:n}}_resizeViewport(){this.props.autoResizeViewport&&this.device.gl&&this.device.gl.viewport(0,0,this.device.gl.drawingBufferWidth,this.device.gl.drawingBufferHeight)}_beginFrameTimers(e){let i=e??(typeof performance<"u"?performance.now():Date.now());if(this._lastFrameTime){let n=i-this._lastFrameTime;n>0&&this.frameRate.addTime(n)}this._lastFrameTime=i,this.device?._isDebugGPUTimeEnabled()&&this._consumeEncodedGpuTime(),this.cpuTime.timeStart()}_endFrameTimers(){this.device?._isDebugGPUTimeEnabled()&&this._consumeEncodedGpuTime(),this.cpuTime.timeEnd(),this._updateSharedStats()}_consumeEncodedGpuTime(){if(!this.device)return;let e=this.device.commandEncoder._gpuTimeMs;e!==void 0&&(this.gpuTime.addTime(e),this.device.commandEncoder._gpuTimeMs=void 0)}_updateSharedStats(){if(this.stats!==this.sharedStats){for(let e of Object.keys(this.sharedStats.stats))this.stats.stats[e]||delete this.sharedStats.stats[e];this.stats.forEach(e=>{let i=this.sharedStats.get(e.name,e.type);i.sampleSize=e.sampleSize,i.time=e.time,i.count=e.count,i.samples=e.samples,i.lastTiming=e.lastTiming,i.lastSampleTime=e.lastSampleTime,i.lastSampleCount=e.lastSampleCount,i._count=e._count,i._time=e._time,i._samples=e._samples,i._startTime=e._startTime,i._timerPending=e._timerPending})}}_startEventHandling(){this.canvas&&(this.canvas.addEventListener("mousemove",this._onMousemove.bind(this)),this.canvas.addEventListener("mouseleave",this._onMouseleave.bind(this)))}_onMousemove(e){e instanceof MouseEvent&&(this._getAnimationProps()._mousePosition=[e.offsetX,e.offsetY])}_onMouseleave(e){this._getAnimationProps()._mousePosition=null}};var ks="transform_output",Ht=class{device;model;sampler;currentIndex=0;samplerTextureMap=null;bindings=[];resources={};constructor(e,i){this.device=e,this.sampler=e.createSampler({addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge",minFilter:"nearest",magFilter:"nearest",mipmapFilter:"nearest"}),this.model=new j(this.device,{id:i.id||T("texture-transform-model"),fs:i.fs||Ee({input:i.targetTextureVarying,inputChannels:i.targetTextureChannels,output:ks}),vertexCount:i.vertexCount,...i}),this._initialize(i),Object.seal(this)}destroy(){this.model.destroy();for(let e of this.bindings)e.framebuffer?.destroy()}delete(){this.destroy()}run(e){let{framebuffer:i}=this.bindings[this.currentIndex],n=this.device.beginRenderPass({framebuffer:i,...e});this.model.draw(n),n.end(),this.device.submit()}getTargetTexture(){let{targetTexture:e}=this.bindings[this.currentIndex];return e}getFramebuffer(){return this.bindings[this.currentIndex].framebuffer}_initialize(e){this._updateBindings(e)}_updateBindings(e){this.bindings[this.currentIndex]=this._updateBinding(this.bindings[this.currentIndex],e)}_updateBinding(e,{sourceBuffers:i,sourceTextures:n,targetTexture:r}){if(e||(e={sourceBuffers:{},sourceTextures:{},targetTexture:null}),Object.assign(e.sourceTextures,n),Object.assign(e.sourceBuffers,i),r){e.targetTexture=r;let{width:o,height:s}=r;e.framebuffer&&e.framebuffer.destroy(),e.framebuffer=this.device.createFramebuffer({id:"transform-framebuffer",width:o,height:s,colorAttachments:[r]}),e.framebuffer.resize({width:o,height:s})}return e}_setSourceTextureParameters(){let e=this.currentIndex,{sourceTextures:i}=this.bindings[e];for(let n in i)i[n].sampler=this.sampler}};var qt=class extends ee{constructor(e={}){let{id:i=T("cube-geometry"),indices:n=!0}=e;super(n?{...e,id:i,topology:"triangle-list",indices:{size:1,value:zs},attributes:{...Ys,...e.attributes}}:{...e,id:i,topology:"triangle-list",indices:void 0,attributes:{...Js,...e.attributes}})}},zs=new Uint16Array([0,1,2,0,2,3,4,5,6,4,6,7,8,9,10,8,10,11,12,13,14,12,14,15,16,17,18,16,18,19,20,21,22,20,22,23]),Vs=new Float32Array([-1,-1,1,1,-1,1,1,1,1,-1,1,1,-1,-1,-1,-1,1,-1,1,1,-1,1,-1,-1,-1,1,-1,-1,1,1,1,1,1,1,1,-1,-1,-1,-1,1,-1,-1,1,-1,1,-1,-1,1,1,-1,-1,1,1,-1,1,1,1,1,-1,1,-1,-1,-1,-1,-1,1,-1,1,1,-1,1,-1]),Ws=new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,1,0,0,1,0,0,1,0,0,1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,1,0,0,1,0,0,1,0,0,1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0]),js=new Float32Array([0,0,1,0,1,1,0,1,1,0,1,1,0,1,0,0,0,1,0,0,1,0,1,1,1,1,0,1,0,0,1,0,1,0,1,1,0,1,0,0,0,0,1,0,1,1,0,1]),Hs=new Uint32Array([0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5]),qs=new Float32Array([1,-1,1,-1,-1,1,-1,-1,-1,1,-1,-1,1,-1,1,-1,-1,-1,1,1,1,1,-1,1,1,-1,-1,1,1,-1,1,1,1,1,-1,-1,-1,1,1,1,1,1,1,1,-1,-1,1,-1,-1,1,1,1,1,-1,-1,-1,1,-1,1,1,-1,1,-1,-1,-1,-1,-1,-1,1,-1,1,-1,1,1,1,-1,1,1,-1,-1,1,-1,-1,1,1,-1,1,1,1,1,1,-1,-1,-1,-1,-1,-1,1,-1,1,1,-1,1,-1,-1,-1,1,-1]),Zs=new Float32Array([1,1,0,1,0,0,1,0,1,1,0,0,1,1,0,1,0,0,1,0,1,1,0,0,1,1,0,1,0,0,1,0,1,1,0,0,1,1,0,1,0,0,1,0,1,1,0,0,1,1,0,1,0,0,0,0,1,0,1,1,1,1,0,1,0,0,1,0,1,1,0,0]),Xs=new Float32Array([1,0,1,1,0,0,1,1,0,0,0,1,1,0,0,1,1,0,1,1,0,0,0,1,1,1,1,1,1,0,1,1,1,0,0,1,1,1,0,1,1,1,1,1,1,0,0,1,0,1,1,1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,1,1,1,1,0,1,0,0,1,1,0,1,1,1,0,1,0,1,0,0,0,1,0,0,1,1,0,1,0,1,1,1,1,1,0,1,1,1,0,0,1,1,0,0,1,1,1,0,1,1,1,1,1,1,1,0,0,1,0,0,0,1,0,1,0,1,1,1,0,1,1,0,0,1,0,1,0,1]),Ks=new Uint32Array([3,3,3,3,3,3,4,4,4,4,4,4,2,2,2,2,2,2,5,5,5,5,5,5,0,0,0,0,0,0,1,1,1,1,1,1]),Ys={POSITION:{size:3,value:Vs},NORMAL:{size:3,value:Ws},TEXCOORD_0:{size:2,value:js},faceIndex:{size:1,value:Hs}},Js={POSITION:{size:3,value:qs},TEXCOORD_0:{size:2,value:Zs},COLOR_0:{size:3,value:Xs},faceIndex:{size:1,value:Ks}};var Zt=class{poolSize=20;bufferPools;constructor(){this.bufferPools=new Map}createOrReuse(e,i){if(i>e.limits.maxBufferSize)throw new Error(`Buffer pool cannot allocate ${i} bytes: device.limits.maxBufferSize is ${e.limits.maxBufferSize}`);let n=this.bufferPools.get(e),r=n?n.findIndex(s=>s.byteLength>=i):-1;if(r<0)return e.createBuffer({usage:A.VERTEX|A.STORAGE|A.COPY_DST|A.COPY_SRC,byteLength:i});let[o]=n.splice(r,1);return o}recycle(e){let i=e.device;this.bufferPools.has(i)||this.bufferPools.set(i,[]);let n=this.bufferPools.get(i),r=n.findIndex(o=>o.byteLength>e.byteLength);r<0?n.push(e):n.splice(r,0,e),this.purge()}purge(){for(let[e,i]of this.bufferPools){let n=e.isLost?0:this.poolSize;for(;i.length>n;)i.shift().destroy();i.length===0&&this.bufferPools.delete(e)}}},de=new Zt;var Dn=/^vertex-list<([^<>]+)>$/,Fn=/^value-list<([^<>]+)>$/;function rt(t){return Dn.test(t)}function ot(t){return Fn.test(t)}function Mn(t){let e=Dn.exec(t),i=Fn.exec(t),n=e?.[1]??i?.[1]??t;try{I.getVertexFormatInfo(n)}catch{throw new Error(`Unsupported GPUVector format ${t}`)}return n}function z(t){let e=Mn(t),i=rt(t),n=ot(t),r=I.getVertexFormatInfo(e),o=r.type,s=r.normalized,a=Qs(o,s);return{format:t,elementFormat:e,vertexList:i,valueList:n,type:o,signedDataType:ea(e,o),primitiveType:a,components:r.components,byteLength:r.byteLength,integer:r.integer,signed:r.signed,normalized:s,...r.webglOnly?{webglOnly:!0}:{}}}function Qs(t,e){if(e)return"f32";switch(t){case"float32":return"f32";case"float16":return"f16";case"uint8":case"uint16":case"uint32":return"u32";case"sint8":case"sint16":case"sint32":return"i32";default:throw new Error(`Unsupported GPUVector component type ${t}`)}}function ea(t,e){if(t==="unorm10-10-10-2")return"uint32";switch(e){case"unorm8":return"uint8";case"snorm8":return"sint8";case"unorm16":return"uint16";case"snorm16":return"sint16";default:return e}}var V=class{buffer;format;length;byteOffset;byteStride;constructor(e){let i=I.getVertexFormatInfo(e.format).byteLength,n=e.byteOffset??0,r=e.byteStride??i;if(Xt(e.length,"GPUDataView length"),Xt(n,"GPUDataView byteOffset"),Xt(r,"GPUDataView byteStride"),r<i)throw new Error(`GPUDataView byteStride ${r} is smaller than ${e.format} byte length ${i}`);let o=e.length===0?0:(e.length-1)*r+i,s=n+o;if(!Number.isSafeInteger(o)||!Number.isSafeInteger(s))throw new Error("GPUDataView byte range must use safe integers");if(s>e.buffer.byteLength)throw new Error("GPUDataView exceeds its backing buffer byte length");this.buffer=e.buffer,this.format=e.format,this.length=e.length,this.byteOffset=n,this.byteStride=r}get elementByteLength(){return I.getVertexFormatInfo(this.format).byteLength}get byteLength(){return this.length===0?0:(this.length-1)*this.byteStride+this.elementByteLength}};function Xt(t,e){if(!Number.isSafeInteger(t)||t<0)throw new Error(`${e} must be a non-negative safe integer`)}function at(t){return!!(t&&typeof t=="object"&&t.type==="struct")}function Un(t,e){let i=Object.entries(t);if(i.length===0)throw new Error("GPUData struct format must declare at least one field");return e==="packed"?ta(i):ia(i)}function ta(t){let e=[],i=0,n=0;for(let[r,o]of t){let s=I.getVertexFormatInfo(o);if(s.webglOnly)throw new Error(`Packed GPUData struct field "${r}" uses WebGL-only format ${o}`);i=Gn(i,Math.min(4,s.byteLength)),e.push([r,Object.freeze({format:o,byteOffset:i,byteLength:s.byteLength})]),i+=s.byteLength,n+=s.components}return Object.freeze({type:"struct",layout:"packed",fields:Object.freeze(Object.fromEntries(e)),components:n,byteStride:Gn(i,4),rowByteLength:i})}function ia(t){let e=Object.fromEntries(t.map(([s,a])=>[s,na(a)])),i=fi(e,{layout:"wgsl-storage"}),n=[],r=0,o=0;for(let[s,a]of t){let u=I.getVertexFormatInfo(a),f=i.fields[s].offset*4;n.push([s,Object.freeze({format:a,byteOffset:f,byteLength:u.byteLength})]),r=Math.max(r,f+u.byteLength),o+=u.components}return Object.freeze({type:"struct",layout:"wgsl-storage",fields:Object.freeze(Object.fromEntries(n)),components:o,byteStride:i.byteLength,rowByteLength:r})}function na(t){let e=I.getVertexFormatInfo(t);switch(e.type){case"float32":return st("f32",e.components);case"sint32":return st("i32",e.components);case"uint32":return st("u32",e.components);default:{let i=Math.ceil(e.byteLength/4);return st("u32",i)}}}function st(t,e){return e===1?t:`vec${e}<${t}>`}function Gn(t,e){return Math.ceil(t/e)*e}var Kt=class{buffer;ownsDataBuffer;constructor(e,i){this.buffer=e,this.ownsDataBuffer=i}get ownsBuffer(){return this.ownsDataBuffer}transferBufferOwnership(e){if(e.buffer!==this.buffer)throw new Error("GPUData ownership can only be transferred to the same buffer");e.ownsDataBuffer=this.ownsDataBuffer,this.ownsDataBuffer=!1}destroy(){this.ownsDataBuffer&&(this.buffer.destroy(),this.ownsDataBuffer=!1)}},Yt=class extends Kt{dataType;format;length;valueLength;stride;byteOffset;byteStride;rowByteLength;readbackMetadata;valueOffsets;nullBitmap;valueByteLength;constructor(e){let{buffer:i,format:n,length:r,valueLength:o,stride:s,byteOffset:a=0,byteStride:u,rowByteLength:f,ownsBuffer:l=!1,readbackMetadata:d,valueOffsets:h,nullBitmap:c,valueByteLength:p,dataType:g}=e;super(i,l);let m;n?typeof n=="string"?m=n:m=Un(n,e.layout??"wgsl-storage"):m=void 0;let v=at(m)?m:void 0,b=typeof m=="string"?z(m):void 0;if(this.dataType=g,this.format=m,this.length=r,this.valueLength=o??r,this.stride=s??b?.components??v?.components??u??f??1,this.byteOffset=a,this.rowByteLength=f??v?.rowByteLength??b?.byteLength??u??this.stride,this.byteStride=u??v?.byteStride??this.rowByteLength,v){if(this.rowByteLength<v.rowByteLength)throw new Error(`GPUData rowByteLength ${this.rowByteLength} is smaller than struct format row byte length ${v.rowByteLength}`);if(this.byteStride<Math.max(v.byteStride,this.rowByteLength))throw new Error(`GPUData byteStride ${this.byteStride} is smaller than its struct row layout`)}this.readbackMetadata=d,this.valueOffsets=h,this.nullBitmap=c,this.valueByteLength=p}getChild(e){if(!at(this.format))return null;let i=this.format.fields[e];return i?new V({buffer:this.buffer,format:i.format,length:this.length,byteOffset:this.byteOffset+i.byteOffset,byteStride:this.byteStride}):null}getChildAt(e){if(!at(this.format))return null;let i=Object.values(this.format.fields)[e];return i?new V({buffer:this.buffer,format:i.format,length:this.length,byteOffset:this.byteOffset+i.byteOffset,byteStride:this.byteStride}):null}},he=Yt;var ie=class{name;dataType;format;length;valueLength;stride;byteOffset;byteStride;rowByteLength;bufferLayout;data=[];device;bufferProps;isAppendable=!1;ownsDataChunks=!0;ownedVectors=[];appendableByteLength=0;constructor(e){switch(e.type){case"buffer":{let{name:i,buffer:n,format:r,length:o,valueLength:s=o,byteOffset:a=0,ownsBuffer:u=!1}=e,{stride:f,byteStride:l,rowByteLength:d}=$n(e);this.name=i,this.dataType=e.dataType,this.format=r,this.length=o,this.valueLength=s,this.stride=f,this.byteOffset=a,this.byteStride=l,this.rowByteLength=d,this.data.push(new he({buffer:n,format:r,length:o,valueLength:s,stride:f,byteOffset:a,byteStride:l,rowByteLength:d,ownsBuffer:u,dataType:e.dataType}));return}case"interleaved":{let{name:i,buffer:n,format:r,length:o,valueLength:s=o,byteOffset:a=0,byteStride:u,attributes:f,ownsBuffer:l=!1}=e;this.name=i,this.dataType=e.dataType,this.format=r,this.length=o,this.valueLength=s,this.stride=u,this.byteOffset=a,this.byteStride=u,this.rowByteLength=u,this.bufferLayout={name:i,byteStride:u,attributes:f},this.data.push(new he({buffer:n,format:r,length:o,valueLength:s,stride:u,byteOffset:a,byteStride:u,rowByteLength:u,ownsBuffer:l,dataType:e.dataType}));return}case"data":{let i=e.format??ra(e.data),n=i?z(i):void 0,{name:r,data:o,stride:s=o[0]?.stride??n?.components??1,valueLength:a=o.reduce((h,c)=>h+c.valueLength,0),byteStride:u=o[0]?.byteStride??n?.byteLength,rowByteLength:f=o[0]?.rowByteLength??n?.byteLength,bufferLayout:l,ownsData:d=!1}=e;if(u===void 0||f===void 0)throw new Error("GPUVector requires format or explicit byte layout metadata");i&&oa(o,i),this.name=r,this.dataType=e.dataType,this.format=i,this.length=o.reduce((h,c)=>h+c.length,0),this.valueLength=a,this.stride=s,this.byteOffset=o.length===1?o[0].byteOffset:0,this.byteStride=u,this.rowByteLength=f,this.bufferLayout=l,this.ownsDataChunks=d,this.data.push(...o);return}case"appendable":{let{name:i,device:n,format:r,valueLength:o=0,bufferProps:s}=e,{stride:a,byteStride:u,rowByteLength:f}=$n(e);this.name=i,this.dataType=e.dataType,this.format=r,this.length=0,this.valueLength=o,this.stride=a,this.byteOffset=0,this.byteStride=u,this.rowByteLength=f,this.device=n,this.bufferProps=s,this.isAppendable=!0;return}}}get ownsBuffer(){return this.ownsDataChunks&&this.data.some(e=>e.ownsBuffer)||this.ownedVectors.some(e=>e.ownsBuffer)}get capacityRows(){return this.isAppendable?this.length:void 0}get appendedByteLength(){return this.appendableByteLength}addData(e){if(this.format&&e.format!==this.format)throw new Error("GPUVector.addData() requires matching formats");if(e.byteStride!==this.byteStride)throw new Error("GPUVector.addData() requires matching byteStride");if(e.rowByteLength!==this.rowByteLength)throw new Error("GPUVector.addData() requires matching rowByteLength");return this.data.push(e),this.length+=e.length,this.valueLength+=e.valueLength,this}appendDataChunk(e,i=this.appendableByteLength+e.buffer.byteLength){if(!this.isAppendable)throw new Error("GPUVector.appendDataChunk() requires appendable vector storage");if(this.format&&e.format!==this.format)throw new Error("GPUVector.appendDataChunk() requires matching formats");if(e.byteStride!==this.byteStride||e.rowByteLength!==this.rowByteLength)throw new Error("GPUVector.appendDataChunk() requires matching byte layout metadata");return this.data.push(e),this.length+=e.length,this.valueLength+=e.valueLength,this.appendableByteLength=i,this}resetLastBatch(){if(!this.isAppendable)throw new Error("GPUVector.resetLastBatch() requires appendable vector storage");for(let e of this.data.splice(0))e.destroy();return this.length=0,this.valueLength=0,this.appendableByteLength=0,this}retainOwnedVectors(e){return this.ownedVectors.push(...e),this}transferBufferOwnership(e){let i=this.data[0],n=e.data[0];if(!i||!n||i.buffer!==n.buffer)throw new Error("GPUVector ownership can only be transferred to the same buffer");i.transferBufferOwnership(n)}destroy(){if(this.ownsDataChunks)for(let e of this.data)e.destroy();for(let e of this.ownedVectors.splice(0))e.destroy()}};function $n(t){let e=t.format?z(t.format):void 0,i=t.rowByteLength??t.byteStride??e?.byteLength;if(i===void 0)throw new Error("GPUVector requires format or explicit rowByteLength");return{stride:t.stride??e?.components??1,byteStride:t.byteStride??i,rowByteLength:i}}function ra(t){return t[0]?.format}function oa(t,e){if(t.find(n=>n.format!==e))throw new Error("GPUVector data chunks must share the declared format")}var H=class t{static get bufferPoolSize(){return de.poolSize}static set bufferPoolSize(e){if(!Number.isSafeInteger(e)||e<0)throw new Error("GPUDataEvaluator.bufferPoolSize must be a non-negative safe integer");de.poolSize=e,de.purge()}type;size;get offset(){return this._offset}get stride(){return this._stride}normalized;isConstant;length;get byteLength(){return this._byteLength}ValueType;source=null;format;_id;_destroyed=!1;_value;_offset;_stride;_byteLength;_gpuVector;_bufferOwnership="owned";_targetBuffer;static fromArray(e,{type:i,size:n=1,offset:r=0,stride:o=0,normalized:s=!1}){let a=i,u;if(Array.isArray(e)){a=a||"float32";let l=pe(a);u=new l(e)}else e instanceof Float64Array?(a="uint32",n*=2,r*=2,o*=2,u=new Uint32Array(e.buffer,e.byteOffset,e.byteLength/4)):(a=a||ti(e),u=e);let f=`<${a} * ${n}>`;return new t({id:f,type:a,size:n,offset:r,stride:o,normalized:s,value:u})}static fromConstant(e,i="float32"){let n=pe(i),r;return Array.isArray(e)?r=`[${e.join(",")}]`:(r=String(e),e=[e]),new t({id:r,isConstant:!0,type:i,size:e.length,value:new n(e)})}static fromGPUData(e,i={}){aa(e);let n=new V({buffer:e.buffer,format:e.format,length:e.length,byteOffset:e.byteOffset,byteStride:e.byteStride});return new t({...kn(n),id:i.id,gpuData:e})}static fromGPUDataView(e,i={}){return new t({...kn(e),id:i.id,buffer:e.buffer})}constructor(e){let{id:i,value:n,buffer:r,gpuData:o,format:s,source:a=null,isConstant:u=!1}=e;if(!a&&!n&&!r&&!o)throw new Error("GPUDataEvaluator must have a value source");let{type:f,size:l,offset:d,stride:h,normalized:c,length:p}=e;if(a instanceof t?(f=f??a.type,l=l??a.size,d=d??a.offset,h=h??a.stride,c=c??a.normalized,p=p??a.length):(l=l??1,d=d??0,c=c??!1,p=u?1:p),!f)throw new Error("GPUDataEvaluator: type not defined");if(this._id=i,this.type=f,this.size=l,this.ValueType=pe(this.type),this._offset=d,this._stride=h||this.ValueType.BYTES_PER_ELEMENT*l,this.normalized=c,this.source=a,this.format=s,p===void 0)if(u)p=1;else{if(!n)throw new Error("GPUDataEvaluator: length not defined");p=Math.ceil(n.byteLength/this.stride)}this.isConstant=u,this.length=p;let g=this.ValueType.BYTES_PER_ELEMENT*this.size;this._byteLength=p===0?0:(p-1)*this.stride+g,this._value=n,this._bufferOwnership=a instanceof t||r||o?"borrowed":"owned",o?this._gpuVector=new ie({type:"data",name:this._id??"data",format:o.format,data:[o],stride:o.stride,byteStride:o.byteStride,rowByteLength:o.rowByteLength}):r&&(this._gpuVector=this.createGPUVectorView({buffer:r,name:this._id,format:this.format}))}get value(){return this._value||(this.source instanceof t?this.source.value:void 0)}get evaluated(){return!!this._gpuVector}get id(){return this._id}get gpuVector(){if(!this._gpuVector)throw new Error(`${this} not evaluated`);return this._gpuVector}get buffer(){return ut(this.gpuVector)}setTargetBuffer({buffer:e,byteOffset:i=0,byteStride:n=this.stride}){if(this._destroyed)throw new Error(`GPUDataEvaluator ${this} already destroyed`);if(this._gpuVector)throw new Error(`GPUDataEvaluator ${this} already evaluated`);if(!this.source||this.source instanceof t)throw new Error("GPUDataEvaluator target buffers require a deferred operation source");this._targetBuffer={buffer:e,byteOffset:i,byteStride:n}}async evaluate(e,i={}){if(this._destroyed)throw new Error(`GPUDataEvaluator ${this} already destroyed`);if(this._gpuVector)return this._gpuVector;let n;if(this.source instanceof t){let r=await this.source.evaluate(e);return this._gpuVector=this.createGPUVectorView({...i,buffer:ut(r)}),this._gpuVector}if(n=this._getEvaluationBuffer(e),this._value)n.write(this._value);else{let r=await this.source.execute(e,n);if(!r.success)throw r.error||new Error(`${this.source} evaluation failed`);r.value&&(this._value=r.value)}return this._gpuVector=this.createGPUVectorView({...i,buffer:n}),this._gpuVector}evaluateSync(e,i={}){if(this._destroyed)throw new Error(`GPUDataEvaluator ${this} already destroyed`);if(this._gpuVector)return this._gpuVector;let n;if(this.source instanceof t){let r=this.source.evaluateSync(e);return this._gpuVector=this.createGPUVectorView({...i,buffer:ut(r)}),this._gpuVector}if(n=this._getEvaluationBuffer(e),this._value)n.write(this._value);else{let r=this.source.executeSync(e,n);if(!r.success)throw r.error||new Error(`${this.source} evaluation failed`);r.value&&(this._value=r.value)}return this._gpuVector=this.createGPUVectorView({...i,buffer:n}),this._gpuVector}createGPUVectorView(e){let i=e.name??this._id??"vector",n=e.format??this.format??la(this.type,this.size,this.normalized);if(e.interleaved){let r=typeof e.interleaved=="object"&&e.interleaved.attributes?e.interleaved.attributes:fa(this);return new ie({type:"interleaved",name:i,buffer:e.buffer,format:e.format??this.format,length:this.length,byteOffset:this.offset,byteStride:this.stride,attributes:r,ownsBuffer:!1})}return new ie({type:"buffer",name:i,buffer:e.buffer,format:n,length:this.length,stride:this.size,byteOffset:this.offset,byteStride:this.stride,rowByteLength:this.ValueType.BYTES_PER_ELEMENT*this.size,ownsBuffer:!1})}_getEvaluationBuffer(e){let i=this._targetBuffer;if(!i)return de.createOrReuse(e,this.byteLength);if(i.buffer.device!==e)throw new Error("GPUDataEvaluator target buffer belongs to a different device");let n=this.ValueType.BYTES_PER_ELEMENT*this.size,r=this.length===0?0:(this.length-1)*i.byteStride+n;if(i.byteOffset+r>i.buffer.byteLength)throw new Error("GPUDataEvaluator target buffer is too small for the output layout");return this._offset=i.byteOffset,this._stride=i.byteStride,this._byteLength=r,this._bufferOwnership="borrowed",this._targetBuffer=void 0,i.buffer}async readValue(e=0,i){let{ValueType:n}=this,{size:r,offset:o,stride:s,length:a}=this,u=n.BYTES_PER_ELEMENT*r;if(i=i??a,e=Math.max(0,Math.min(a,e)),i=Math.max(e,Math.min(a,i)),this._value)return sa(this,this._value,e,i);let f=i-e;if(f===0)return new n(0);let l=o+e*s,d=s===u?f*u:(f-1)*s+u,h=await this.buffer.readAsync(l,d),c=new n(h.buffer,h.byteOffset,h.byteLength/n.BYTES_PER_ELEMENT);if(s===u)return c;let p=new Uint8Array(u*f);for(let g=0;g<f;g++){let m=g*s;p.set(h.subarray(m,m+u),g*u)}return new n(p.buffer)}async ensureCPUValue(){let e=this.value;if(e)return e;let i=await this.buffer.readAsync(0,this.offset+this.byteLength);if(i.byteLength%this.ValueType.BYTES_PER_ELEMENT!==0)throw new Error(`${this} backing buffer byte length is not aligned to its scalar type`);let n=i.slice();return this._value=new this.ValueType(n.buffer,n.byteOffset,n.byteLength/this.ValueType.BYTES_PER_ELEMENT),this._value}ensureCPUValueSync(){let e=this.value;if(e)return e;throw new Error(`${this} CPU value is not available for synchronous evaluation`)}toString(){return this._id??this.source?.toString()??this.constructor.name}destroy(){this._gpuVector&&(this._bufferOwnership==="owned"&&de.recycle(ut(this._gpuVector)),this._gpuVector=void 0),this._targetBuffer=void 0,this._destroyed=!0}};function sa(t,e,i,n){let{ValueType:r,size:o,offset:s,stride:a}=t,u=a/r.BYTES_PER_ELEMENT,f=s/r.BYTES_PER_ELEMENT,l=n-i;if(u===o){let h=f+i*u;return e.subarray(h,h+l*o)}let d=new r(l*o);for(let h=0;h<l;h++){let c=f+(i+h)*u;d.set(e.subarray(c,c+o),h*o)}return d}function gc(t){if(t instanceof H)return t;if(typeof t=="number"||Array.isArray(t))return H.fromConstant(t);if(t instanceof he)return H.fromGPUData(t);if(t instanceof V)return H.fromGPUDataView(t);throw new Error("getGPUDataEvaluator() requires GPUDataEvaluator, GPUData, GPUDataView, number, or number[]")}function aa(t){if(!t.format)throw new Error("GPUDataEvaluator.fromGPUData() requires GPUData format metadata");if(rt(t.format)||ot(t.format))throw new Error("GPUDataEvaluator.fromGPUData() does not support variable-length input");let i=z(t.format).byteLength;if(t.rowByteLength!==i)throw new Error(`GPUDataEvaluator.fromGPUData() requires rowByteLength ${i} for GPUData`)}function kn(t){let e=z(t.format),i=pe(e.signedDataType),n=i.BYTES_PER_ELEMENT*e.components;if(e.byteLength!==n)throw new Error(`GPUDataEvaluator does not support packed vertex format ${t.format}: ${e.byteLength} physical bytes cannot expose ${e.components} ${e.signedDataType} components`);if(t.byteOffset%i.BYTES_PER_ELEMENT!==0||t.byteStride%i.BYTES_PER_ELEMENT!==0)throw new Error(`GPUDataEvaluator requires ${t.format} offset and stride aligned to ${i.BYTES_PER_ELEMENT} bytes`);return{type:e.signedDataType,size:e.components,offset:t.byteOffset,stride:t.byteStride,normalized:e.normalized,length:t.length,format:t.format}}function ut(t){let e=ua(t).buffer;return e instanceof O?e.buffer:e}function ua(t){let[e,...i]=t.data;if(!e||i.length>0)throw new Error(`GPUDataEvaluator requires exactly one GPUData chunk for "${t.name}"`);return e}function fa(t){let e=[];return zn(t,e,{byteOffset:0}),e}function zn(t,e,i){let n=t.source;if(n&&!(n instanceof H)&&n.name==="interleave"){for(let r of Object.values(n.inputs))r instanceof H&&zn(r,e,i);return}e.push({attribute:t.id??t.toString(),format:Vn(t.type,t.size,t.normalized),byteOffset:i.byteOffset}),i.byteOffset+=t.ValueType.BYTES_PER_ELEMENT*t.size}function Vn(t,e,i=!1){if(e<1||e>4)throw new Error(`Cannot synthesize a GPUVector vertex format with ${e} components`);let n=t;if(i)switch(t){case"uint8":n="unorm8";break;case"sint8":n="snorm8";break;case"uint16":n="unorm16";break;case"sint16":n="snorm16";break;case"float32":n="float32";break;default:throw new Error(`Unsupported normalized vertex format for ${t}`)}return(n==="uint8"||n==="sint8"||n==="uint16"||n==="sint16"||n==="unorm8"||n==="snorm8"||n==="unorm16"||n==="snorm16")&&e===3?`${n}x3-webgl`:`${n}${e===1?"":`x${e}`}`}function la(t,e,i=!1){return e>=1&&e<=4?Vn(t,e,i):void 0}var _c={add:{arity:2,symbol:"arithmetic_add"},subtract:{arity:2,symbol:"arithmetic_subtract"},multiply:{arity:2,symbol:"arithmetic_multiply"},divide:{arity:2,symbol:"arithmetic_divide"},pow:{arity:2,symbol:"pow"},sqrt:{arity:1,symbol:"sqrt"},abs:{arity:1,symbol:"abs"},sin:{arity:1,symbol:"sin"},cos:{arity:1,symbol:"cos"},tan:{arity:1,symbol:"arithmetic_tan"},exp:{arity:1,symbol:"exp"},log:{arity:1,symbol:"log"}};function Wn(t,{operations:e,inputs:i}){switch(t.kind){case"input":if(!(t.name in i))throw new Error(`Unknown expression input '${t.name}'`);return;case"literal":if(Array.isArray(t.value)){for(let n of t.value)if(!Number.isFinite(n))throw new Error(`Expression literal array must contain only finite values, got ${n}`)}else if(!Number.isFinite(t.value))throw new Error(`Expression literal must be finite, got ${t.value}`);return;case"call":{let n=e[t.op];if(!n)throw new Error(`Unknown expression op '${t.op}'`);if(t.args.length!==n.arity)throw new Error(`Expression op '${t.op}' expects ${n.arity} args, got ${t.args.length}`);for(let r of t.args)Wn(r,{operations:e,inputs:i});return}default:{let n=t;throw new Error(`Unsupported expression node ${n.kind}`)}}}function yc(t,e){return Wn(t,e),jn(t,e)}function jn(t,e){switch(t.kind){case"input":{let i=e.inputs[t.name];return e.laneIndex<i.size?e.formatInput(t.name):e.formatOutOfBoundsInput(t.name)}case"literal":return e.formatLiteral(t.value);case"call":{let i=e.operations[t.op],n=t.args.map(r=>jn(r,e));return e.formatCall(i.symbol,n)}default:{let i=t;throw new Error(`Unsupported expression node ${i.kind}`)}}}export{F as a,qe as b,ae as c,Zn as d,ko as e,Ko as f,pn as g,gn as h,ee as i,Rt as j,Wt as k,jt as l,O as m,j as n,kt as o,Ht as p,qt as q,Vt as r,ie as s,de as t,H as u,gc as v,_c as w,yc as x};
