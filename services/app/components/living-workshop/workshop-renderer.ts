import { workshopPosterUrl } from "./workshop-assets";
import { WORKSHOP_IMAGE_WIDTHS, workshopImageAt } from "./scene-manifest";
import { addWorkshopHelpers } from "./workshop-helpers";
import { separatePapers, floorClearance, PAPER_FLOOR } from "./paper-contact";
import { applyForegroundMask } from "./foreground-mask";
import {
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  DirectionalLight,
} from "three";
import {
  beginGesture,
  moveGesture,
  SCENE,
  scenePoint,
  type PaperGesture,
} from "./paper-model";
import {
  makeCloth,
  isPerforatedPaper,
  liftPaper,
  releaseCloth,
  stepCloth,
  type Cloth,
} from "./paper-physics";
import { type WorkshopPaper, type WorkshopSetting } from "./scene-manifest";

export interface WorkshopScene {
  setSetting(setting: WorkshopSetting): void;
  dispose(): void;
}
interface Sheet {
  paper: WorkshopPaper;
  cloth: Cloth;
  mesh: Mesh<BufferGeometry, MeshLambertMaterial>;
  shadow: Mesh<BufferGeometry, MeshBasicMaterial>;
  texture: CanvasTexture;
  image: HTMLImageElement;
  indices: number[];
  lastTorn: number;
  loading: boolean;
  loadingStock?: HTMLCanvasElement;
}
/** Loaded lazily by the public homepage.
 * Canvas textures must be origin-clean. Physics stays renderer-independent.
 */
export function createWorkshopScene(
  canvas: HTMLCanvasElement,
  papers: WorkshopPaper[],
  setting: WorkshopSetting,
): WorkshopScene | null {
  delete canvas.dataset.ready;
  // The HTML painting stays visible until the first complete composition.
  let backgroundReady = false;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
  } catch {
    return null;
  }
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0, 0);
  const scene = new Scene(),
    camera = new OrthographicCamera(0, SCENE.width, 0, SCENE.height, 0.1, 2000);
  camera.position.z = 1000;
  camera.layers.enable(1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  scene.add(new AmbientLight(0xffffff, 2.8));
  const light = new DirectionalLight(0xfff7e8, 1.15);
  light.position.set(-400, -700, 1000);
  scene.add(light);
  let foregroundCoverage: Uint8ClampedArray | null = null;
  let lastLoadingFrame = 0;
  let frame = 0,
    last = 0,
    accumulator = 0,
    visible = true,
    disposed = false,
    gesture: PaperGesture | null = null,
    grabIndex = 0,
    activePointer: number | null = null,
    relaxUntil = 0;
  const relaxing = new Set<string>();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const images: HTMLImageElement[] = [],
    extras: Array<Mesh<BufferGeometry, MeshBasicMaterial>> = [];
  const sheets: Sheet[] = papers.map((paper, index) => {
    const cloth = makeCloth(
      paper.x,
      paper.y,
      paper.width,
      paper.height,
      paper.angle,
      index,
    );
    const positions = new Float32Array(cloth.points.length * 3),
      uvs: number[] = [],
      indices: number[] = [];
    cloth.points.forEach((p, i) => {
      positions.set([p.x, p.y, p.z], i * 3);
      uvs.push(
        (i % (cloth.columns + 1)) / cloth.columns,
        1 - Math.floor(i / (cloth.columns + 1)) / cloth.rows,
      );
    });
    for (let r = 0; r < cloth.rows; r++)
      for (let c = 0; c < cloth.columns; c++) {
        const a = r * (cloth.columns + 1) + c,
          b = a + 1,
          d = a + cloth.columns + 2,
          e = d - 1;
        indices.push(a, e, b, b, e, d);
      }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const surface = document.createElement("canvas");
    surface.width = 512;
    surface.height = Math.round((512 * paper.height) / paper.width);
    const texture = new CanvasTexture(surface);
    texture.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(
      geo,
      new MeshLambertMaterial({
        map: texture,
        side: DoubleSide,
        transparent: false,
        alphaTest: 0.1,
        color: 0xfffcf5,
      }),
    );
    // A lifted page exposes unprinted stock on its reverse, not mirrored text.
    mesh.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        "#include <map_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = vec3(0.96, 0.91, 0.80);",
      );
    };
    mesh.material.customProgramCacheKey = () => "workshop-paper-back-v1";
    mesh.frustumCulled = false;
    const shadow = new Mesh(
      geo.clone(),
      new MeshBasicMaterial({
        color: new Color("#3c301e"),
        transparent: true,
        opacity: 0.13,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    shadow.position.set(4, 7, -4);
    shadow.frustumCulled = false;
    scene.add(shadow, mesh);
    const image = new Image(),
      sheet: Sheet = {
        paper,
        cloth,
        mesh,
        shadow,
        texture,
        image,
        indices,
        lastTorn: 0,
        loading: true,
      };
    images.push(image);
    paintPoster(sheet, index);
    image.onload = () => {
      if (!disposed) {
        sheet.loading = false;
        paintPoster(sheet, index);
        schedule();
      }
    };
    image.onerror = () => {
      if (!disposed) {
        // Keep the paper placeholder: one failed export must not block the scene.
        sheet.loading = false;
        paintPoster(sheet, index);
        schedule();
      }
    };
    // Vite alone provides this local cross-origin bridge. Production loads
    // the existing export URL directly from the canonical app origin.
    // Set CORS mode before src: exports can redirect to a separate asset host.
    // Without it, pixel reads and WebGL uploads throw after an otherwise successful load.
    // A host without CORS follows onerror and keeps the existing paper placeholder.
    image.crossOrigin = "anonymous";
    image.src = workshopPosterUrl(paper.image, !!import.meta.env?.DEV);
    return sheet;
  });
  function paintPoster(sheet: Sheet, index: number) {
    const surface = sheet.texture.image as HTMLCanvasElement,
      c = surface.getContext("2d");
    if (!c) return;
    const w = surface.width,
      h = surface.height;
    c.clearRect(0, 0, w, h);
    // Slightly deckled stock, with the actual artifact printed across the page.
    // Crop like a photographic print instead of floating a card in empty margins.
    c.save();
    c.beginPath();
    for (let x = 0; x <= w; x += 4)
      c.lineTo(x, 2 + Math.sin(x * 1.7 + index) * 1.2);
    for (let y = 0; y <= h; y += 4)
      c.lineTo(w - 2 + Math.sin(y * 1.3 + index), y);
    for (let x = w; x >= 0; x -= 4)
      c.lineTo(x, h - 2 + Math.sin(x * 0.9 + index) * 1.3);
    for (let y = h; y >= 0; y -= 4) c.lineTo(2 + Math.sin(y * 1.1 + index), y);
    c.closePath();
    c.clip();
    c.fillStyle = index % 2 ? "#f7f0dc" : "#fffcf1";
    c.fillRect(0, 0, w, h);
    if (sheet.image.complete && sheet.image.naturalWidth) {
      const margin = 15;
      const scale = Math.max(
        (w - margin * 2) / sheet.image.naturalWidth,
        (h - margin * 2) / sheet.image.naturalHeight,
      );
      const dw = sheet.image.naturalWidth * scale,
        dh = sheet.image.naturalHeight * scale;
      c.save();
      c.beginPath();
      c.rect(margin, margin, w - margin * 2, h - margin * 2);
      c.clip();
      c.drawImage(sheet.image, (w - dw) / 2, (h - dh) / 2, dw, dh);
      // Blend blue ink with luminance, never the original hue: pale chart fills
      // and antialiased edges must turn blue too, while true grays stay neutral.
      // This runs only when painting a texture, never in the animation loop.
      const print = c.getImageData(margin, margin, w - margin * 2, h - margin * 2);
      const ink = [17, 42, 92], cobalt = [35, 83, 166], stock = [255, 255, 255];
      for (let pixel = 0; pixel < print.data.length; pixel += 4) {
        const red = print.data[pixel]!, green = print.data[pixel + 1]!, blue = print.data[pixel + 2]!;
        const maximum = Math.max(red, green, blue);
        const saturation = maximum ? (maximum - Math.min(red, green, blue)) / maximum : 0;
        const strength = Math.min(1, saturation / 0.4);
        if (!strength) continue;
        const light = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
        const from = light < 0.45 ? ink : cobalt;
        const to = light < 0.45 ? cobalt : stock;
        const mix = light < 0.45 ? light / 0.45 : (light - 0.45) / 0.55;
        for (let channel = 0; channel < 3; channel++) {
          const tinted = from[channel]! + (to[channel]! - from[channel]!) * mix;
          const neutral = light * 255;
          print.data[pixel + channel] = neutral + (tinted - neutral) * strength;
        }
      }
      c.putImageData(print, margin, margin);
      c.restore();
    }
    // Light fiber speckles and a warm edge tie the printed surface to the room.
    for (let i = 0; i < 950; i++) {
      c.fillStyle = i % 2 ? "#71563208" : "#ffffff24";
      c.fillRect((i * 73.37 + index * 13) % w, (i * 127.13) % h, 0.7, 0.7);
    }
    const edge = c.createLinearGradient(0, 0, 9, 0);
    edge.addColorStop(0, "#65503424");
    edge.addColorStop(1, "#65503400");
    c.fillStyle = edge;
    c.fillRect(0, 0, 9, h);
    // A couple of notebook sheets, not six identical punched strips.
    if (isPerforatedPaper(index)) {
      c.globalCompositeOperation = "destination-out";
      c.fillStyle = "#000";
      for (let x = 18; x < w - 10; x += 24) {
        c.beginPath();
        c.arc(x, 13, 5, 0, Math.PI * 2);
        c.fill();
      }
      // Match the physical seam between the second and third vertex rows.
      for (let x = 8; x < w - 8; x += 12)
        c.fillRect(x, (2 * h) / sheet.cloth.rows - 1.2, 4, 2.4);
      c.globalCompositeOperation = "source-over";
    }
    if (index === 1 || index === 4) {
      const crease = c.createLinearGradient(w * 0.46, 0, w * 0.54, 0);
      crease.addColorStop(0, "#0000");
      crease.addColorStop(0.48, "#70573112");
      crease.addColorStop(0.52, "#ffffff55");
      crease.addColorStop(1, "#0000");
      c.fillStyle = crease;
      c.fillRect(0, 0, w, h);
    }
    if (index === 2 || index === 5) {
      c.fillStyle = "#dfd2b4";
      c.beginPath();
      c.moveTo(w - 28, h);
      c.lineTo(w, h - 28);
      c.lineTo(w - 28, h - 28);
      c.closePath();
      c.fill();
    }
    c.restore();
    if (sheet.loading) {
      // Cache the paper once. Spinner frames only repaint this small texture,
      // without rebuilding the stock, reading pixels, or touching loaded posters.
      const stock = document.createElement("canvas");
      stock.width = w;
      stock.height = h;
      stock.getContext("2d")?.drawImage(surface, 0, 0);
      sheet.loadingStock = stock;
      paintLoadingIndicator(sheet, 0);
    } else {
      sheet.loadingStock = undefined;
    }
    sheet.texture.needsUpdate = true;
  }
  function paintLoadingIndicator(sheet: Sheet, time: number) {
    if (!sheet.loadingStock) return;
    const surface = sheet.texture.image as HTMLCanvasElement;
    const context = surface.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, surface.width, surface.height);
    context.drawImage(sheet.loadingStock, 0, 0);
    context.save();
    context.translate(surface.width / 2, surface.height / 2);
    context.lineWidth = 5;
    context.strokeStyle = "#d8d0bd";
    context.beginPath();
    context.arc(0, 0, 24, 0, Math.PI * 2);
    context.stroke();
    context.rotate(time / 240);
    context.strokeStyle = "#2456a1";
    context.lineCap = "round";
    context.beginPath();
    context.arc(0, 0, 24, 0, Math.PI * 0.7);
    context.stroke();
    context.restore();
    sheet.texture.needsUpdate = true;
  }
  function quad(texture: CanvasTexture, z: number) {
    const g = new BufferGeometry();
    g.setAttribute(
      "position",
      new Float32BufferAttribute(
        [
          0,
          0,
          z,
          SCENE.width,
          0,
          z,
          0,
          SCENE.height,
          z,
          SCENE.width,
          SCENE.height,
          z,
        ],
        3,
      ),
    );
    g.setAttribute(
      "uv",
      new Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2),
    );
    g.setIndex([0, 2, 1, 1, 2, 3]);
    const mesh = new Mesh(
      g,
      new MeshBasicMaterial({
        map: texture,
        // The cutout participates in depth like real foreground geometry.
        // Transparent sorting uses object origins, which are shared by these quads.
        transparent: z !== 65,
        side: DoubleSide,
        depthWrite: z === 0 || z === 65,
        alphaTest: 0.01,
      }),
    );
    scene.add(mesh);
    extras.push(mesh);
  }
  // Bold painted feature notes sit above the board and beneath the paper mesh.
  const stencilSurface = document.createElement("canvas");
  stencilSurface.width = SCENE.width * 2;
  stencilSurface.height = SCENE.height * 2;
  const stencilContext = stencilSurface.getContext("2d");
  if (stencilContext) {
    stencilContext.scale(2, 2);
    const notes = [
      ["Change it with", "your own hands"],
      ["Work on it", "together"],
      ["Don’t waste", "tokens"],
      ["Make work you’re", "proud to share"],
      ["Bring your", "favorite agent"],
      ["Artifactbin is", "truly yours"],
    ];
    papers.forEach((paper, index) => {
      const ink = document.createElement("canvas");
      ink.width = Math.ceil(paper.width * 2);
      ink.height = 90;
      const context = ink.getContext("2d");
      if (!context) return;
      context.scale(2, 2);
      context.fillStyle = "#174c91";
      context.font = 'bold 15px "Courier New", monospace';
      context.textAlign = "center";
      const lines = notes[index % notes.length];
      lines.forEach((line, row) => context.fillText(line.toLowerCase(), paper.width / 2, 16 + row * 18, paper.width - 30));
      stencilContext.save();
      stencilContext.translate(paper.x, paper.y);
      stencilContext.rotate(paper.angle);
      stencilContext.globalAlpha = 0.95;
      stencilContext.drawImage(ink, 0, paper.height * (index < 3 ? 0.76 : 0.68), paper.width, 45);
      stencilContext.restore();
    });
    const stencilTexture = new CanvasTexture(stencilSurface);
    stencilTexture.colorSpace = SRGBColorSpace;
    quad(stencilTexture, 2);
  }
  const helpers = setting.liveRobots
    ? addWorkshopHelpers(renderer, schedule, setting.name)
    : null;
  const background = new Image();
  const mask = new Image();
  images.push(background, mask);
  const base = document.createElement("canvas");
  const front = document.createElement("canvas");
  base.width = front.width = SCENE.width;
  base.height = front.height = SCENE.height;
  const bt = new CanvasTexture(base),
    ft = new CanvasTexture(front);
  bt.colorSpace = ft.colorSpace = SRGBColorSpace;
  quad(bt, 0);
  quad(ft, 65);
  const paintBackground = () => {
    if (disposed || !background.complete || !background.naturalWidth) return;
    // Texture resolution follows the source; geometry and hit testing stay in scene units.
    const scale = Math.min(
      1,
      renderer.capabilities.maxTextureSize /
        Math.max(background.naturalWidth, background.naturalHeight),
    );
    const width = Math.round(background.naturalWidth * scale);
    const height = Math.round(background.naturalHeight * scale);
    if (base.width !== width || base.height !== height) {
      // Three textures must be reallocated when a responsive image changes size.
      bt.dispose();
      ft.dispose();
    }
    base.width = front.width = width;
    base.height = front.height = height;
    const b = base.getContext("2d"),
      f = front.getContext("2d", { willReadFrequently: true });
    if (!b || !f) return;
    b.drawImage(background, 0, 0, width, height);
    bt.needsUpdate = true;
    if (foregroundCoverage) {
      f.drawImage(mask, 0, 0, width, height);
      const coverage = f.getImageData(0, 0, width, height).data;
      f.clearRect(0, 0, width, height);
      f.drawImage(background, 0, 0, width, height);
      const pixels = f.getImageData(0, 0, width, height);
      applyForegroundMask(pixels.data, coverage);
      f.putImageData(pixels, 0, 0);
    }
    ft.needsUpdate = true;
    backgroundReady = foregroundCoverage !== null;
    schedule();
  };
  background.onload = paintBackground;
  mask.onload = () => {
    if (disposed) return;
    const coverageCanvas = document.createElement("canvas");
    coverageCanvas.width = SCENE.width;
    coverageCanvas.height = SCENE.height;
    const f = coverageCanvas.getContext("2d");
    if (!f) return;
    f.drawImage(mask, 0, 0, SCENE.width, SCENE.height);
    foregroundCoverage = f.getImageData(0, 0, SCENE.width, SCENE.height).data;
    paintBackground();
  };
  mask.src = setting.mask;
  let currentSetting = setting.name;
  let loadedWidth = 0;
  function selectBackground() {
    const required =
      canvas.getBoundingClientRect().width *
      Math.min(window.devicePixelRatio || 1, 2);
    const width =
      WORKSHOP_IMAGE_WIDTHS.find((size) => size >= required) ?? 3344;
    // Retain a larger loaded texture when shrinking, avoiding repeated downloads.
    if (width <= loadedWidth) return;
    loadedWidth = width;
    background.src = workshopImageAt(currentSetting, width);
  }
  selectBackground();
  const setSetting = (next: WorkshopSetting) => {
    if (next.name === currentSetting) return;
    currentSetting = next.name;
    helpers?.setEnvironment(next.name);
    loadedWidth = 0;
    selectBackground();
  };
  // Pin heads are independent of the sheet, left in place when it falls.
  const pinSurface = document.createElement("canvas");
  pinSurface.width = SCENE.width;
  pinSurface.height = SCENE.height;
  const pins = pinSurface.getContext("2d");
  if (pins) {
    papers.forEach((p, i) => {
      pins.save();
      pins.translate(p.x, p.y);
      pins.rotate(p.angle);
      const xs = [4, p.width - 4];
      xs.forEach((x) => {
        pins.shadowColor = "#33261155";
        pins.shadowBlur = 3;
        pins.shadowOffsetY = 2;
        pins.fillStyle = i % 2 ? "#355644" : "#1f4967";
        pins.beginPath();
        pins.arc(x, 5, 3.3, 0, Math.PI * 2);
        pins.fill();
      });
      pins.restore();
    });
    const pt = new CanvasTexture(pinSurface);
    pt.colorSpace = SRGBColorSpace;
    quad(pt, 22);
  }
  function updateMesh(s: Sheet) {
    const pos = s.mesh.geometry.getAttribute("position");
    s.cloth.points.forEach((p, i) => pos.setXYZ(i, p.x, p.y, p.z));
    pos.needsUpdate = true;
    if (s.lastTorn !== s.cloth.torn.size) {
      const cuts = new Set<string>();
      for (const b of s.cloth.bonds)
        if (b.broken) cuts.add(`${Math.min(b.a, b.b)}:${Math.max(b.a, b.b)}`);
      const kept: number[] = [];
      for (let i = 0; i < s.indices.length; i += 3) {
        const t = s.indices.slice(i, i + 3);
        if (
          ![
            [t[0], t[1]],
            [t[1], t[2]],
            [t[2], t[0]],
          ].some(([a, b]) => cuts.has(`${Math.min(a, b)}:${Math.max(a, b)}`))
        )
          kept.push(...t);
      }
      s.mesh.geometry.setIndex(kept);
      s.shadow.geometry.setIndex(kept);
      s.lastTorn = s.cloth.torn.size;
    }
    s.mesh.geometry.computeVertexNormals();
    s.mesh.geometry.computeBoundingSphere();
    const lifted = !s.cloth.pinned;
    const shadowPos = s.shadow.geometry.getAttribute("position");
    const strip =
      s.cloth.attachment === "perforated" ? 2 * (s.cloth.columns + 1) : 0;
    s.cloth.points.forEach((p, i) => {
      if (!lifted || i < strip) shadowPos.setXYZ(i, p.x + 3, p.y + 4, p.z - 3);
      else {
        const h = Math.max(0, floorClearance(p)),
          z = p.z + h * 0.06;
        shadowPos.setXYZ(
          i,
          p.x + h * 0.08,
          PAPER_FLOOR.y + PAPER_FLOOR.slope * z + 0.3,
          z,
        );
      }
    });
    shadowPos.needsUpdate = true;
    s.shadow.position.set(0, 0, 0);
    s.shadow.material.opacity = lifted ? 0.075 : 0.13;
  }
  function draw(time: number) {
    frame = 0;
    if (disposed) return;
    // Show the live scene as soon as its background is ready. Each poster
    // repaints independently; a slow export must not hold the robots hostage.
    if (!backgroundReady) return;
    const dt = Math.min(0.05, (time - (last || time)) / 1000);
    last = time;
    accumulator += dt;
    let moving = false;
    while (accumulator >= 1 / 60) {
      for (const s of sheets) {
        const held = gesture?.id === s.paper.id && gesture.dragging;
        if (
          held ||
          (!s.cloth.pinned && !s.cloth.settled) ||
          (time < relaxUntil && relaxing.has(s.paper.id))
        ) {
          const grab = held
            ? {
                index: grabIndex,
                x: gesture!.current.x,
                y: gesture!.current.y,
                z: 98,
              }
            : undefined;
          if (reduced.matches && !held && !s.cloth.pinned) {
            s.cloth.settled = true;
            s.mesh.visible = false;
            s.shadow.visible = false;
            continue;
          }
          stepCloth(s.cloth, 1 / 60, grab);
        }
      }
      separatePapers(sheets.filter((s) => s.mesh.visible).map((s) => s.cloth));
      accumulator -= 1 / 60;
    }
    moving =
      sheets.some((s) => !s.cloth.pinned && !s.cloth.settled) ||
      !!gesture?.dragging ||
      time < relaxUntil;
    for (const s of sheets) {
      // Only untouched, attached sheets idle in the breeze. The top edge stays
      // fixed; picking reads these same points, and grabbing takes over directly.
      if (
        !reduced.matches && s.cloth.pinned && s.cloth.torn.size === 0 &&
        s.cloth.pins.every(Boolean) && gesture?.id !== s.paper.id &&
        !(time < relaxUntil && relaxing.has(s.paper.id))
      ) {
        const phase = time / 1000 * 1.5 + s.cloth.seed * 1.7;
        s.cloth.points.forEach((p, index) => {
          const row = Math.floor(index / (s.cloth.columns + 1)) / s.cloth.rows;
          const column = (index % (s.cloth.columns + 1)) / s.cloth.columns;
          const loose = row * row * row;
          const flutter = Math.sin(phase + column * 2.2);
          p.x = p.px = p.homeX + loose * flutter * 1.5;
          p.y = p.py = p.homeY - loose * (1 + flutter) * 1.8;
          p.z = p.pz = p.homeZ + loose * (1 + flutter) * 5;
        });
      }
      updateMesh(s);
    }
    if (!reduced.matches && time - lastLoadingFrame >= 100) {
      for (const sheet of sheets) if (sheet.loading) paintLoadingIndicator(sheet, time);
      lastLoadingFrame = time;
    }
    if (!reduced.matches) helpers?.update(dt);
    renderer.render(scene, camera);
    helpers?.render(renderer, camera);
    canvas.dataset.ready = "true";
    if (moving || (!reduced.matches && (helpers || sheets.some((s) => s.cloth.pinned)))) schedule();
  }
  function schedule() {
    if (!disposed && visible && !frame) frame = requestAnimationFrame(draw);
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(r.width, r.height, false);
    selectBackground();
    schedule();
  }
  function locate(event: PointerEvent) {
    const p = scenePoint(
      { x: event.clientX, y: event.clientY },
      canvas.getBoundingClientRect(),
    );
    // Orthographic picking uses the same deformed triangles as the renderer.
    // This also makes the interaction independent of texture transparency.
    const ordered = [...sheets].sort(
      (a, b) =>
        Number(a.cloth.pinned) - Number(b.cloth.pinned) ||
        b.cloth.order - a.cloth.order,
    );
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
    const sheet = ordered.find((s) => {
      if (
        s.cloth.pinned &&
        foregroundCoverage &&
        p.x >= 0 &&
        p.x < SCENE.width &&
        p.y >= 0 &&
        p.y < SCENE.height &&
        foregroundCoverage[
          (Math.floor(p.y) * SCENE.width + Math.floor(p.x)) * 4
        ] > 127
      )
        return false;
      const indices = s.mesh.geometry.getIndex()!.array;
      for (let i = 0; i < indices.length; i += 3) {
        const a = s.cloth.points[indices[i]],
          b = s.cloth.points[indices[i + 1]],
          c = s.cloth.points[indices[i + 2]];
        if (
          Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) <
          0.001
        )
          continue;
        const d1 = cross(a, b),
          d2 = cross(b, c),
          d3 = cross(c, a);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)))
          return true;
      }
      return false;
    });
    return { p, sheet };
  }
  function down(event: PointerEvent) {
    if (activePointer !== null || event.button !== 0) return;
    const { p, sheet } = locate(event);
    if (!sheet && !reduced.matches) {
      const rect = canvas.getBoundingClientRect();
      if (helpers?.jumpAt(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
        camera,
      )) return;
    }
    if (!sheet) return;
    activePointer = event.pointerId;
    gesture = beginGesture(sheet.paper.id, p);
    grabIndex = 0;
    let distance = Infinity;
    sheet.cloth.points.forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < distance) {
        distance = d;
        grabIndex = i;
      }
    });
    sheet.cloth.settled = false;
    if (!sheet.cloth.pinned) {
      liftPaper(sheet.cloth);
      for (const other of sheets)
        if (!other.cloth.pinned) {
          other.cloth.settled = false;
          other.cloth.quietFrames = 0;
        }
    }
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  }
  function move(event: PointerEvent) {
    const { p, sheet } = locate(event);
    if (gesture && event.pointerId === activePointer)
      gesture = moveGesture(gesture, p);
    const rect = canvas.getBoundingClientRect();
    const bot = !sheet && helpers?.hitBot(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
      camera,
    );
    canvas.style.cursor = gesture ? "grabbing" : sheet || bot ? "grab" : "default";
    schedule();
  }
  function finish(event: PointerEvent) {
    if (!gesture || event.pointerId !== activePointer) return;
    const s = sheets.find((s) => s.paper.id === gesture!.id),
      cancelled = event.type !== "pointerup",
      dragged = gesture.dragging;
    gesture = null;
    activePointer = null;
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    if (s) {
      if (dragged) {
        if (s.cloth.attachment === "perforated" && s.cloth.tearProgress > 0.65)
          releaseCloth(s.cloth);
        if (!s.cloth.pinned) {
          s.cloth.age = 0;
        }
      } else if (!cancelled) window.location.assign(s.paper.href);
    }
    canvas.style.cursor = "grab";
    if (s) relaxing.add(s.paper.id);
    relaxUntil = performance.now() + 1800;
    schedule();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) {
      last = 0;
      schedule();
    } else {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  });
  visibility.observe(canvas);
  const loss = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const restore = () => schedule();
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("lostpointercapture", finish);
  canvas.addEventListener("webglcontextlost", loss);
  canvas.addEventListener("webglcontextrestored", restore);
  resize();
  return {
    setSetting,
    dispose() {
      disposed = true;
      delete canvas.dataset.ready;
      helpers?.dispose();
      cancelAnimationFrame(frame);
      observer.disconnect();
      visibility.disconnect();
      images.forEach((image) => {
        image.onload = null;
        image.onerror = null;
      });
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", finish);
      canvas.removeEventListener("pointercancel", finish);
      canvas.removeEventListener("lostpointercapture", finish);
      canvas.removeEventListener("webglcontextlost", loss);
      canvas.removeEventListener("webglcontextrestored", restore);
      for (const s of sheets) {
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        s.shadow.geometry.dispose();
        s.shadow.material.dispose();
        s.texture.dispose();
      }
      for (const mesh of extras) {
        mesh.geometry.dispose();
        mesh.material.map?.dispose();
        mesh.material.dispose();
      }
      renderer.dispose();
    },
  };
}
