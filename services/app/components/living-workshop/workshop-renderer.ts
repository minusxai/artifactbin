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
  liftPaper,
  releaseCloth,
  resetCloth,
  stepCloth,
  type Cloth,
} from "./paper-physics";
import { type WorkshopPaper, type WorkshopSetting } from "./scene-manifest";

export interface WorkshopScene {
  reset(): void;
  detach(id: string): void;
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
}
/** Imported only by the lazy workshop route, never by the existing home.
 * Same-origin textures are required by WebGL. Physics stays renderer-independent.
 */
export function createWorkshopScene(
  canvas: HTMLCanvasElement,
  papers: WorkshopPaper[],
  onReveal: (paper: WorkshopPaper | null) => void,
  setting: WorkshopSetting,
): WorkshopScene | null {
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
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  scene.add(new AmbientLight(0xffffff, 2.8));
  const light = new DirectionalLight(0xfff7e8, 1.15);
  light.position.set(-400, -700, 1000);
  scene.add(light);
  let foregroundCoverage: Uint8ClampedArray | null = null;
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
      sheet = {
        paper,
        cloth,
        mesh,
        shadow,
        texture,
        image,
        indices,
        lastTorn: 0,
      };
    images.push(image);
    paintPoster(sheet, index);
    image.onload = () => {
      if (!disposed) {
        paintPoster(sheet, index);
        schedule();
      }
    };
    image.onerror = () => {
      if (!disposed) schedule();
    };
    image.src = `/api/showcase/${paper.id}`;
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
    if (index === 0 || index === 3) {
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
    sheet.texture.needsUpdate = true;
  }
  function quad(texture: CanvasTexture, z: number) {
    const g = new BufferGeometry();
    g.setAttribute(
      "position",
      new Float32BufferAttribute(
        [0, 0, z, 1448, 0, z, 0, 1086, z, 1448, 1086, z],
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
        transparent: true,
        side: DoubleSide,
        depthWrite: z === 0,
        alphaTest: 0.01,
      }),
    );
    scene.add(mesh);
    extras.push(mesh);
  }
  // Screen marks join the depth-tested scene, so a foreground sheet can cover
  // them. The same inline SVGs remain the non-WebGL accessible fallback.
  const screenSurface = document.createElement("canvas");
  screenSurface.width = 1448;
  screenSurface.height = 1086;
  const screenContext = screenSurface.getContext("2d");
  if (screenContext) {
    const screenTexture = new CanvasTexture(screenSurface);
    screenTexture.colorSpace = SRGBColorSpace;
    quad(screenTexture, 66);
    for (const svg of canvas.parentElement?.querySelectorAll<SVGSVGElement>(
      ".workshop-agent",
    ) || []) {
      const copy = svg.cloneNode(true) as SVGSVGElement;
      copy.setAttribute("width", "1448");
      copy.setAttribute("height", "1086");
      copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const source = new Image();
      images.push(source);
      source.onload = () => {
        if (disposed) return;
        screenContext.drawImage(source, 0, 0, 1448, 1086);
        screenTexture.needsUpdate = true;
        schedule();
      };
      source.src =
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(new XMLSerializer().serializeToString(copy));
    }
  }
  const background = new Image();
  images.push(background);
  background.onload = () => {
    if (disposed) return;
    const base = document.createElement("canvas");
    base.width = 1448;
    base.height = 1086;
    const b = base.getContext("2d");
    if (!b) return;
    b.drawImage(background, 0, 0, 1448, 1086);
    const bt = new CanvasTexture(base);
    bt.colorSpace = SRGBColorSpace;
    quad(bt, 0);
    const mask = new Image();
    images.push(mask);
    mask.onload = () => {
      if (disposed) return;
      const front = document.createElement("canvas");
      front.width = 1448;
      front.height = 1086;
      const f = front.getContext("2d");
      if (!f) return;
      f.drawImage(mask, 0, 0, 1448, 1086);
      foregroundCoverage = f.getImageData(0, 0, 1448, 1086).data;
      f.clearRect(0, 0, 1448, 1086);
      f.drawImage(background, 0, 0, 1448, 1086);
      const pixels = f.getImageData(0, 0, 1448, 1086);
      applyForegroundMask(pixels.data, foregroundCoverage);
      f.putImageData(pixels, 0, 0);
      const ft = new CanvasTexture(front);
      ft.colorSpace = SRGBColorSpace;
      quad(ft, 65);
      schedule();
    };
    mask.src = setting.mask;
    schedule();
  };
  background.src = setting.image;
  // Pin heads are independent of the sheet, left in place when it falls.
  const pinSurface = document.createElement("canvas");
  pinSurface.width = 1448;
  pinSurface.height = 1086;
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
          const wasPinned = s.cloth.pinned;
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
          if (wasPinned && !s.cloth.pinned) onReveal(s.paper);
        }
      }
      separatePapers(sheets.filter((s) => s.mesh.visible).map((s) => s.cloth));
      accumulator -= 1 / 60;
    }
    moving =
      sheets.some((s) => !s.cloth.pinned && !s.cloth.settled) ||
      !!gesture?.dragging ||
      time < relaxUntil;
    for (const s of sheets) updateMesh(s);
    renderer.render(scene, camera);
    if (moving) schedule();
  }
  function schedule() {
    if (!disposed && visible && !frame) frame = requestAnimationFrame(draw);
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(r.width, r.height, false);
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
        p.x < 1448 &&
        p.y >= 0 &&
        p.y < 1086 &&
        foregroundCoverage[(Math.floor(p.y) * 1448 + Math.floor(p.x)) * 4] > 127
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
    canvas.style.cursor = gesture ? "grabbing" : sheet ? "grab" : "default";
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
          onReveal(s.paper);
        }
      } else if (!cancelled) window.location.assign(s.paper.href);
    }
    canvas.style.cursor = "grab";
    if (s) relaxing.add(s.paper.id);
    relaxUntil = performance.now() + 1800;
    schedule();
  }
  function detach(id: string) {
    const s = sheets.find((s) => s.paper.id === id);
    if (!s) return;
    releaseCloth(s.cloth);
    onReveal(s.paper);
    schedule();
  }
  function reset() {
    gesture = null;
    if (activePointer !== null && canvas.hasPointerCapture(activePointer))
      canvas.releasePointerCapture(activePointer);
    activePointer = null;
    relaxing.clear();
    for (const s of sheets) {
      s.mesh.visible = true;
      s.shadow.visible = true;
      resetCloth(s.cloth);
      s.mesh.geometry.setIndex(s.indices);
      s.shadow.geometry.setIndex(s.indices);
      s.lastTorn = 0;
      updateMesh(s);
    }
    onReveal(null);
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
    detach,
    reset,
    dispose() {
      disposed = true;
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
