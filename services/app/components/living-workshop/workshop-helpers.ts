import { createHelperShadows } from "./helper-shadows";
/** Experimental rigid-joint helpers, registered in the painting's pixel space. */
import {
  AnimationMixer,
  Raycaster,
  Vector2,
  Vector3,
  PMREMGenerator,
  AmbientLight,
  HemisphereLight,
  DirectionalLight,
  PointLight,
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
export function addWorkshopHelpers(
  renderer: WebGLRenderer,
  wake: () => void,
  setting: "indoor" | "outdoor" = "indoor",
) {
  const projectedShadows = createHelperShadows();
  const outdoors = setting === "outdoor";
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
  const ambient = new AmbientLight(
    outdoors ? 0xf3f5ed : 0xece8db,
    outdoors ? 0.95 : 0.65,
  );
  ambient.layers.set(1);
  group.add(ambient);
  const key = new DirectionalLight(
    outdoors ? 0xfff9ed : 0xfff7e8,
    outdoors ? 4.0 : 4.5,
  );
  key.layers.set(1);
  key.position.set(-650, outdoors ? -1000 : -200, outdoors ? 1100 : 650);
  key.target.position.set(850, 400, 0);
  group.add(key.target);
  group.add(key);
  // The painted pendant at the upper right is the second direct source.
  const bulb = new PointLight(0xffd19b, 240000, 1800, 2);
  bulb.layers.set(1);
  bulb.position.set(1400, 85, 260);
  group.add(bulb);
  const sky = new HemisphereLight(0xe4f1ff, 0xd6caa4, 0);
  {
    sky.position.set(0, -1, 0);
    sky.layers.set(1);
    group.add(sky);
  }
  // The arm's final pass shares the helpers' lighting.
  for (const light of [ambient, key, bulb, sky]) light.layers.enable(2);
  const setEnvironment = (name: "indoor" | "outdoor") => {
    const outside = name === "outdoor";
    projectedShadows.setEnvironment(name);
    ambient.color.set(outside ? 0xf3f5ed : 0xece8db);
    ambient.intensity = outside ? 0.95 : 0.65;
    key.color.set(outside ? 0xfff9ed : 0xfff7e8);
    key.intensity = outside ? 4 : 4.5;
    key.position.set(-650, outside ? -1000 : -200, outside ? 1100 : 650);
    bulb.intensity = outside ? 0 : 240000;
    sky.intensity = outside ? 1 : 0;
  };
  setEnvironment(setting);
  let disposed = false;
  const mixers: AnimationMixer[] = [];
  const dancingArms: Array<{
    joint: Object3D;
    x: number;
    z: number;
    side: number;
  }> = [];
  const gestures: Array<{
    role: string;
    head?: Object3D;
    gazeTarget?: Object3D;
    torso?: Object3D;
    arm?: Object3D;
    armRest: [number, number, number];
    headRest: [number, number, number];
    torsoRest: [number, number, number];
    offset: number;
  }> = [];
  const gaze = new Vector3();
  const faceForward = new Vector3(0, 0, 1);
  let elapsed = 0;
  const hoppingBots: Array<{ mount: Group; restY: number; started: number; joints: Array<{ object: Object3D; rest: number; bend: number }> }> = [];
  const botRay = new Raycaster();
  botRay.layers.set(1);
  botRay.layers.enable(2);
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
  contactShadow(910, 727, 48, 10);
  contactShadow(675, 483, 45, 8);
  contactShadow(565, 664, 55, 12);
  contactShadow(1036, 705, 48, 10);
  contactShadow(1357, 514, 62, 10);
  const loader = new GLTFLoader();
  const textureLoader = new TextureLoader();
  const placements = [
    {
      x: 910,
      y: 727,
      size: 57,
      turn: 0.824,
      agent: "opencode",
      role: "inspector",
      offset: 1.3,
    },
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
      turn: 0.34,
      agent: "codex",
      role: "pencil",
      offset: 2.2,
    },
    {
      x: 1036,
      y: 705,
      size: 56,
      turn: 0.4,
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
          if (m.name === "Warm porcelain / pastel ivory")
            m.color.set("#fff3dc");
          if (m.name === "Light cream enamel") m.color.set("#fff9ec");
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
      const gltf = await loader.loadAsync(
        ROOT + `workshop-bot-${p.role}.glb?pose=close-inspection-2`,
      );
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
      let gazeTarget: Object3D | undefined;
      let head: Object3D | undefined,
        torso: Object3D | undefined,
        arm: Object3D | undefined;
      model.traverse((o) => {
        if (/^Magnifying[ _]glass[ _]ivory[ _]rim/.test(o.name)) gazeTarget = o;
        if (
          p.role === "paper" &&
          /^Paper[ _](left|right)[ _]shoulder(?:[._]?\d+)?$/.test(o.name)
        ) {
          dancingArms.push({
            joint: o,
            x: o.rotation.x,
            z: o.rotation.z,
            side: o.name.includes("left") ? -1 : 1,
          });
        }
        if (
          p.role === "inspector" &&
          /^Inspector[ _]right[ _]elbow(?:[._]?\d+)?$/.test(o.name)
        )
          arm = o;
        if (/^Head[ _]tilt/.test(o.name)) head = o;
        if (p.role === "pencil" && /^Pencil[ _]cradle/.test(o.name)) arm = o;
        if (
          p.role === "standing" &&
          /^Pointing[ _]elbow(?:[._]?\d+)?$/.test(o.name)
        )
          arm = o;
        if (/^Torso(?:[._]?\d+)?$/.test(o.name)) torso = o;
      });
      if (p.role === "inspector" && torso?.parent) {
        // Put the bend at the hips, below the chest, while keeping both feet planted.
        const hipBend = new Group();
        hipBend.position.copy(torso.position);
        hipBend.position.y -= 0.3;
        torso.parent.add(hipBend);
        model.updateMatrixWorld(true);
        hipBend.attach(torso);
        torso = hipBend;
      }
      gestures.push({
        role: p.role,
        head,
        gazeTarget,
        torso,
        arm,
        armRest: [
          arm?.rotation.x ?? 0,
          arm?.rotation.y ?? 0,
          arm?.rotation.z ?? 0,
        ],
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
        if (
          p.role === "inspector" &&
          /^Magnifying[ _]glass[ _]ivory[ _]rim/.test(o.name)
        ) {
          const rim = new MeshStandardMaterial({
            color: "#005bbf",
            roughness: 0.3,
          });
          o.material = rim;
          materials.add(rim);
        }
        const source = Array.isArray(o.material) ? o.material[0] : o.material;
        if (
          p.role === "pencil" &&
          source instanceof MeshStandardMaterial &&
          /^(Oversized[ _]cobalt[ _]pencil|Pencil[ _].*[ _]graphite)/.test(
            o.name,
          )
        ) {
          const paint = source.clone();
          paint.color.set("#245da9");
          paint.roughness = 0.92;
          paint.metalness = 0;
          paint.envMapIntensity = 0.08;
          o.material = paint;
          materials.add(paint);
        }
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
      // The inspector stands in front of the painted woman, so its entire
      // silhouette belongs in the foreground pass alongside the arm.
      if (p.role === "inspector") model.traverse((object) => object.layers.set(2));
      group.add(mount);
      const joints: Array<{ object: Object3D; rest: number; bend: number }> = [];
      model.traverse((object) => {
        if (/^(Left|Right)[ _](knee|hip)(?:[._]?\d+)?$/.test(object.name))
          joints.push({ object, rest: object.rotation.x, bend: /knee/.test(object.name) ? 0.85 : -0.42 });
      });
      hoppingBots.push({ mount, restY: p.y, started: -Infinity, joints });
      projectedShadows.add(mount, p.y, 30, p.role === "standing");
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
      gltf.scene.traverse((object) => object.layers.set(2));
      const mount = new Group();
      mount.position.set(1357, 514, 22);
      mount.scale.set(93, -93, 93);
      gltf.scene.rotation.y = 0.15;
      gltf.scene.rotation.x = 0.16;
      mount.add(gltf.scene);
      group.add(mount);
      projectedShadows.add(mount, 514, 22, true);
      const mixer = new AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) mixer.clipAction(clip).play();
      mixers.push(mixer);
      wake();
    })
    .catch(() => {});
  return {
    setEnvironment,
    hitBot: (x: number, y: number, camera: Camera) => {
      scene.updateMatrixWorld(true);
      botRay.setFromCamera(new Vector2(x, y), camera);
      return botRay.intersectObjects(hoppingBots.map((bot) => bot.mount), true).length > 0;
    },
    jumpAt: (x: number, y: number, camera: Camera) => {
      scene.updateMatrixWorld(true);
      botRay.setFromCamera(new Vector2(x, y), camera);
      const hit = botRay.intersectObjects(hoppingBots.map((bot) => bot.mount), true)[0];
      if (!hit) return false;
      const bot = hoppingBots.find(({ mount }) => {
        let object: Object3D | null = hit.object;
        while (object) {
          if (object === mount) return true;
          object = object.parent;
        }
        return false;
      });
      if (!bot) return false;
      if (elapsed - bot.started >= 0.9) bot.started = elapsed;
      wake();
      return true;
    },
    update: (dt: number) => {
      elapsed += dt;
      for (const mixer of mixers) mixer.update(dt);
      for (const bot of hoppingBots) {
        const age = elapsed - bot.started;
        const flight = Math.max(0, Math.min(1, (age - 0.18) / 0.55));
        const crouch = age < 0.18 ? Math.sin(age / 0.18 * Math.PI / 2)
          : age < 0.28 ? 1 - (age - 0.18) / 0.1
          : age > 0.73 && age < 0.9 ? 0.45 * Math.sin((age - 0.73) / 0.17 * Math.PI) : 0;
        bot.mount.position.y = bot.restY + (bot.joints.length ? 8 * crouch : 0) - 48 * 4 * flight * (1 - flight);
        for (const joint of bot.joints) joint.object.rotation.x = joint.rest + joint.bend * crouch;
      }
      for (const a of dancingArms) {
        const beat = elapsed * 3.4 + a.side * 0.7;
        a.joint.rotation.x = a.x + 0.6 * Math.sin(beat);
        a.joint.rotation.z =
          a.z + a.side * (0.18 + 0.44 * Math.sin(beat + 0.8));
      }
      for (const g of gestures) {
        const t = elapsed + g.offset;
        if (g.head) {
          const [x, y, z] = g.headRest;
          if (g.role === "inspector")
            g.head.rotation.set(
              x + 0.38 + 0.1 * Math.sin(t * 0.8),
              y - 0.25 + 0.1 * Math.sin(t * 0.55),
              z + 0.04 * Math.sin(t),
            );
          if (g.role === "pencil")
            g.head.rotation.set(
              x + 0.6 * Math.sin(t * 0.85),
              y + 0.3 * Math.sin(t * 0.55),
              z,
            );
          if (g.role === "paper")
            g.head.rotation.set(
              x + 0.18 * Math.sin(t * 3.0),
              y + 0.4 * Math.sin(t * 1.5),
              z + 0.6 * Math.sin(t * 3.0),
            );
          if (g.role === "standing") {
            const phase = t % 9;
            const nod =
              phase > 2 && phase < 4.5
                ? 0.6 *
                  Math.sin((phase - 2) * 10) *
                  Math.sin(((phase - 2) / 2.5) * Math.PI)
                : 0.05 * Math.sin(t);
            g.head.rotation.set(x + nod, y + 0.32 + 0.4 * Math.sin(t * 0.8), z);
          }
        }
        if (g.arm) {
          const [x, y, z] = g.armRest;
          if (g.role === "inspector")
            g.arm.rotation.set(
              x + 0.05 * Math.sin(t * 0.8),
              y,
              z + 0.05 * Math.sin(t * 0.8),
            );
          if (g.role === "pencil")
            g.arm.rotation.set(
              x + 0.13 * Math.sin(t * 1.4),
              y,
              z + 0.18 * Math.sin(t * 1.4 + 0.5),
            );
          if (g.role === "standing")
            g.arm.rotation.set(
              x + 0.14 * Math.sin(t * 1.8),
              y,
              z + 0.28 * Math.sin(t * 1.8),
            );
        }
        if (g.torso) {
          const [x, y, z] = g.torsoRest;
          g.torso.rotation.set(
            x +
              (g.role === "inspector"
                ? 0.824 + 0.12 * Math.sin(t * 0.8)
                : g.role === "pencil"
                  ? 0.09 * Math.sin(t * 1.1)
                  : 0),
            y + (g.role === "paper" ? 0.12 * Math.sin(t * 3.0) : 0),
            z + (g.role === "paper" ? 0.17 * Math.sin(t * 3.0 + 0.7) : 0),
          );
        }
        if (g.role === "inspector" && g.head?.parent && g.gazeTarget) {
          // Aim the monitor's forward axis at the moving lens in head-parent space.
          g.gazeTarget.getWorldPosition(gaze);
          g.head.parent.worldToLocal(gaze);
          gaze.sub(g.head.position).normalize();
          // Keep the monitor readable in three-quarter view while glancing down.
          const yaw = Math.max(
            -0.35,
            Math.min(0.35, Math.atan2(gaze.x, gaze.z)),
          );
          const pitch = Math.min(0.65, Math.max(0.25, -Math.asin(gaze.y)));
          gaze.set(
            Math.sin(yaw) * Math.cos(pitch),
            -Math.sin(pitch),
            Math.cos(yaw) * Math.cos(pitch),
          );
          g.head.quaternion.setFromUnitVectors(faceForward, gaze);
          g.head.rotateY(-Math.PI / 18);
        }
      }
    },
    render: (renderer: WebGLRenderer, camera: Camera) => {
      const clear = renderer.autoClear,
        tone = renderer.toneMapping,
        exposure = renderer.toneMappingExposure;
      renderer.autoClear = false;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      projectedShadows.render(renderer, camera);
      renderer.render(scene, camera);
      // Draw foreground helpers above the painting cutout and papers,
      // retaining depth testing between their own parts.
      const cameraLayers = camera.layers.mask;
      camera.layers.set(2);
      renderer.clearDepth();
      renderer.render(scene, camera);
      camera.layers.mask = cameraLayers;
      renderer.autoClear = clear;
      renderer.toneMapping = tone;
      renderer.toneMappingExposure = exposure;
    },
    dispose: () => {
      disposed = true;
      group.removeFromParent();
      environment.dispose();
      projectedShadows.dispose();
      for (const mixer of mixers) mixer.stopAllAction();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
