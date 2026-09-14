/** Isolated model review boundary: owns WebGL, GLB animation and cleanup.
 * Loaded only by the standalone robot review page, never by the landing hero.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type RobotAgent = "claude" | "codex" | "pi";
const ROOT = "/landing/workshop/robots/";
export function createRobotPreview(
  canvas: HTMLCanvasElement,
  ready: () => void,
  failed: () => void,
) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 30);
  camera.position.set(3.1, 2.65, 6.3);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0.15, 1.0, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 3.5;
  controls.maxDistance = 9;
  controls.maxPolarAngle = Math.PI * 0.49;
  scene.add(new THREE.HemisphereLight(0xfff8e6, 0x8d9baf, 2.5));
  const key = new THREE.DirectionalLight(0xfff7df, 3.2);
  key.position.set(-3, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.normalBias = 0.025;
  scene.add(key);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.ShadowMaterial({ opacity: 0.16 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.015;
  floor.receiveShadow = true;
  scene.add(floor);
  const mixers: THREE.AnimationMixer[] = [];
  const textures = new Map<RobotAgent, THREE.Texture>();
  let badge: THREE.MeshStandardMaterial | undefined;
  let agent: RobotAgent = "claude";
  let disposed = false;
  let playing = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = 0;
  let previous = performance.now();
  function disposeObject(root: THREE.Object3D) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial)
          material.map?.dispose();
        material.dispose();
      }
    });
  }
  const loader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const loads = (["claude", "codex", "pi"] as const).map(async (name) => {
    const texture = await textureLoader.loadAsync(`${ROOT}badge-${name}.png`);
    if (disposed) {
      texture.dispose();
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    textures.set(name, texture);
  });
  const modelLoads = ["workshop-bot.glb", "workshop-arm.glb"].map(
    async (file, index) => {
      const gltf = await loader.loadAsync(ROOT + file);
      if (disposed) {
        disposeObject(gltf.scene);
        return;
      }
      gltf.scene.position.set(index === 0 ? -0.85 : 1.3, 0, 0);
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
        const material = Array.isArray(object.material)
          ? object.material[0]
          : object.material;
        if (
          material instanceof THREE.MeshStandardMaterial &&
          material.name.startsWith("Agent chest badge")
        )
          badge = material;
      });
      scene.add(gltf.scene);
      const mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) mixer.clipAction(clip).play();
      mixers.push(mixer);
    },
  );
  const setAgent = (value: RobotAgent) => {
    agent = value;
    const texture = textures.get(agent);
    if (badge && texture) {
      badge.map = texture;
      badge.emissiveMap = texture;
      badge.transparent = true;
      badge.depthWrite = true;
      badge.alphaTest = 0.15;
      badge.needsUpdate = true;
    }
  };
  void Promise.all([...loads, ...modelLoads])
    .then(() => {
      if (disposed) return;
      setAgent(agent);
      ready();
    })
    .catch(() => {
      if (!disposed) failed();
    });
  const resize = new ResizeObserver(() => {
    const { width, height } = canvas.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  });
  resize.observe(canvas);
  function tick(now: number) {
    if (disposed) return;
    const elapsed = Math.min((now - previous) / 1000, 0.05);
    previous = now;
    if (playing) for (const mixer of mixers) mixer.update(elapsed);
    controls.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
  return {
    setAgent,
    setPlaying: (value: boolean) => {
      playing = value;
    },
    resetView: () => {
      camera.position.set(3.1, 2.65, 6.3);
      controls.target.set(0.15, 1, 0);
      controls.update();
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      for (const mixer of mixers) mixer.stopAllAction();
      disposeObject(scene);
      for (const texture of textures.values()) texture.dispose();
      renderer.dispose();
    },
  };
}
