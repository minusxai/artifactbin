// Optional live CDN canary/manual demo; deliberately not a merge gate.
import assert from 'node:assert/strict';
import {startDocument} from '../lib/start-doc.mjs';
const base=process.argv[2];assert(base&&new URL(base).hostname==='localhost','local verification only');
const seed=await startDocument(base);
const source=`
const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true,preserveDrawingBuffer:true});
renderer.setSize(320,240,false);const scene=new THREE.Scene();scene.background=new THREE.Color('#101820');
const camera=new THREE.PerspectiveCamera(45,4/3,.1,100);camera.position.z=4;
const geometry=new THREE.BoxGeometry(1.5,1.5,1.5),material=new THREE.MeshNormalMaterial();
const cube=new THREE.Mesh(geometry,material);scene.add(cube);
function draw(){renderer.render(scene,camera);const gl=renderer.getContext(),pixel=new Uint8Array(4);gl.readPixels(160,120,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);mx.params.set('rendered',pixel[0]>60&&pixel[1]>60);}
draw();document.querySelector('button').onclick=()=>{cube.rotation.y+=.5;draw();mx.mutate('inc');};
addEventListener('pagehide',()=>{geometry.dispose();material.dispose();renderer.dispose();});
`;
const markup='<Helmet><Value name="rendered" type="boolean" default={false}/><Value name="count" type="number" default={0}/><Mutation name="inc">{`update _signals set count=count+1`}</Mutation></Helmet><h1>Managed Three.js verification</h1><p>CDN bundle → cached asset host → isolated canvas.</p><p aria-label="Canvas verified">Rendered cube pixels: {$rendered}</p><p aria-label="Rotation count">Rotations: {$count}</p><Iframe title="Isolated Three cube" height={300}><style>{`body{margin:0;background:#101820;color:white}button{height:40px;margin:8px}`}</style><canvas width={320} height={240}/><button aria-label="Rotate cube">Rotate cube</button><script src="https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.min.js"/><script>{'+JSON.stringify(source)+'}</script></Iframe>';
const demo='<div className="mx-auto max-w-3xl p-8 pt-24">'+markup+'</div>';
const result=await fetch(base+'/api/artifacts/'+seed.id,{method:'PUT',headers:{Authorization:'Bearer '+seed.token,'Content-Type':'application/json'},body:JSON.stringify({markup:demo,expectedVersion:1})});assert(result.ok,await result.text());
console.log(base+'/a/'+seed.id);
