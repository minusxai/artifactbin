export * from 'three';
export { OrbitControls } from 'three/addons/controls/OrbitControls.js';
export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Required by any glb exported with meshopt compression (EXT_meshopt_compression): GLTFLoader refuses those without it.
export { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
