/** Experimental rigid-joint helpers, registered in the painting's pixel space. */
import {
  AnimationMixer,
  PMREMGenerator,
  AmbientLight,
  DirectionalLight,
  CanvasTexture,
  PlaneGeometry,
  MeshBasicMaterial,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  TextureLoader,
  Scene,
  ACESFilmicToneMapping,
  type WebGLRenderer,
  type Camera,
  type Object3D,
  type Texture,
  type BufferGeometry,
  type Material,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const ROOT = "/landing/workshop/robots/";
export function addWorkshopHelpers(renderer: WebGLRenderer, wake: () => void) {
  const scene = new Scene();
  const room = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.16;
  scene.environmentRotation.x = Math.PI;
  room.dispose();
  pmrem.dispose();
  const group = new Group();
  scene.add(group);
  // Paper lighting is intentionally bright. Helpers get their own softer rig.
  const ambient = new AmbientLight(0xece8db, 1.1);
  ambient.layers.set(1);
  group.add(ambient);
  const key = new DirectionalLight(0xfff1dc, 3.0);
  key.layers.set(1);
  key.position.set(-400, -700, 1000);
  group.add(key);
  const fill = new DirectionalLight(0xdce8ff, 1.4);
  fill.layers.set(1);
  fill.position.set(900, 200, 900);
  group.add(fill);
  let disposed = false;
  const mixers: AnimationMixer[] = [];
  const gestures: Array<{
    role: string;
    head?: Object3D;
    torso?: Object3D;
    headRest: [number, number, number];
    torsoRest: [number, number, number];
    offset: number;
  }> = [];
  let elapsed = 0;
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  function contactShadow(x: number, y: number, w: number, h: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const c = canvas.getContext("2d")!;
    const g = c.createRadialGradient(64, 32, 2, 64, 32, 32);
    g.addColorStop(0, "#29231c66");
    g.addColorStop(1, "#29231c00");
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 64);
    const texture = new CanvasTexture(canvas);
    textures.add(texture);
    const geo = new PlaneGeometry(w, h);
    geometries.add(geo);
    const mat = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    materials.add(mat);
    const shadow = new Mesh(geo, mat);
    shadow.position.set(x, y, 2);
    group.add(shadow);
  }
  contactShadow(675, 483, 45, 8);
  contactShadow(565, 664, 55, 12);
  contactShadow(1019, 705, 48, 10);
  contactShadow(1357, 514, 62, 10);
  const loader = new GLTFLoader();
  const textureLoader = new TextureLoader();
  const placements = [
    {
      x: 675,
      y: 483,
      size: 60,
      turn: 0.42,
      agent: "claude",
      role: "standing",
      offset: 0,
    },
    {
      x: 565,
      y: 664,
      size: 64,
      turn: -0.2,
      agent: "codex",
      role: "pencil",
      offset: 2.2,
    },
    {
      x: 1019,
      y: 705,
      size: 56,
      turn: -0.48,
      agent: "pi",
      role: "paper",
      offset: 4.1,
    },
  ];
  function remember(root: Object3D) {
    root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      o.layers.set(1);
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(m);
        if (m instanceof MeshStandardMaterial) {
          if (m.name === "Smoked monitor glass") {
            m.envMapIntensity = 0.12;
            m.roughness = 0.4;
          }
          if (m.name === "Charcoal joint rubber") m.envMapIntensity = 0.2;
          if (m.name === "Cobalt blue enamel") {
            m.color.set("#005bbf");
            m.roughness = 0.3;
          }
          if (m.map) textures.add(m.map);
          if (m.emissiveMap) textures.add(m.emissiveMap);
        }
      }
    });
  }
  void Promise.all(
    placements.map(async (p) => {
      const gltf = await loader.loadAsync(ROOT + `workshop-bot-${p.role}.glb`);
      remember(gltf.scene);
      const texture = await textureLoader.loadAsync(
        ROOT + `badge-${p.agent}.png`,
      );
      if (disposed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = SRGBColorSpace;
      texture.flipY = false;
      textures.add(texture);
      const model = gltf.scene.clone(true);
      let head: Object3D | undefined, torso: Object3D | undefined;
      model.traverse((o) => {
        if (/^Head[ _]tilt/.test(o.name)) head = o;
        if (/^Torso(?:[._]?\d+)?$/.test(o.name)) torso = o;
      });
      gestures.push({
        role: p.role,
        head,
        torso,
        headRest: [
          head?.rotation.x ?? 0,
          head?.rotation.y ?? 0,
          head?.rotation.z ?? 0,
        ],
        torsoRest: [
          torso?.rotation.x ?? 0,
          torso?.rotation.y ?? 0,
          torso?.rotation.z ?? 0,
        ],
        offset: p.offset,
      });
      model.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const source = Array.isArray(o.material) ? o.material[0] : o.material;
        if (
          source instanceof MeshStandardMaterial &&
          source.name.startsWith("Agent chest badge")
        ) {
          const material = source.clone();
          material.map = texture;
          material.emissiveMap = texture;
          material.transparent = true;
          material.alphaTest = 0.15;
          material.depthWrite = true;
          material.needsUpdate = true;
          o.material = material;
          materials.add(material);
        }
      });
      const mount = new Group();
      mount.position.set(p.x, p.y, 30);
      mount.scale.set(p.size * 1.08, -p.size, p.size);
      model.rotation.y = p.turn;
      model.rotation.x = 0.1;
      mount.add(model);
      group.add(mount);
      const mixer = new AnimationMixer(model);
      for (const clip of gltf.animations) mixer.clipAction(clip).play();
      mixer.update(p.offset);
      mixers.push(mixer);
    }),
  )
    .then(wake)
    .catch(() => {
      /* The painting remains usable if experimental assets fail. */
    });
  void loader
    .loadAsync(ROOT + "workshop-arm.glb")
    .then((gltf) => {
      remember(gltf.scene);
      if (disposed) return;
      const mount = new Group();
      mount.position.set(1357, 514, 22);
      mount.scale.set(93, -93, 93);
      gltf.scene.rotation.y = 0.15;
      gltf.scene.rotation.x = 0.16;
      mount.add(gltf.scene);
      group.add(mount);
      const mixer = new AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) mixer.clipAction(clip).play();
      mixers.push(mixer);
      wake();
    })
    .catch(() => {});
  return {
    update: (dt: number) => {
      elapsed += dt;
      for (const mixer of mixers) mixer.update(dt);
      for (const g of gestures) {
        const t = elapsed + g.offset;
        if (g.head) {
          const [x, y, z] = g.headRest;
          if (g.role === "pencil")
            g.head.rotation.set(
              x + 0.23 * Math.sin(t * 0.7),
              y + 0.1 * Math.sin(t * 0.43),
              z,
            );
          if (g.role === "paper")
            g.head.rotation.set(
              x + 0.035 * Math.sin(t * 2.4),
              y + 0.08 * Math.sin(t * 1.2),
              z + 0.12 * Math.sin(t * 2.4),
            );
          if (g.role === "standing") {
            const phase = t % 9;
            const nod =
              phase > 2 && phase < 4.5
                ? 0.23 *
                  Math.sin((phase - 2) * 10) *
                  Math.sin(((phase - 2) / 2.5) * Math.PI)
                : 0.025 * Math.sin(t);
            g.head.rotation.set(
              x + nod,
              y + 0.32 + 0.16 * Math.sin(t * 0.65),
              z,
            );
          }
        }
        if (g.torso) {
          const [x, y, z] = g.torsoRest;
          g.torso.rotation.set(
            x + (g.role === "pencil" ? 0.018 * Math.sin(t * 1.1) : 0),
            y,
            z + (g.role === "paper" ? 0.012 * Math.sin(t * 2.4) : 0),
          );
        }
      }
    },
    render: (renderer: WebGLRenderer, camera: Camera) => {
      const clear = renderer.autoClear,
        tone = renderer.toneMapping,
        exposure = renderer.toneMappingExposure;
      renderer.autoClear = false;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.render(scene, camera);
      renderer.autoClear = clear;
      renderer.toneMapping = tone;
      renderer.toneMappingExposure = exposure;
    },
    dispose: () => {
      disposed = true;
      group.removeFromParent();
      environment.dispose();
      for (const mixer of mixers) mixer.stopAllAction();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
