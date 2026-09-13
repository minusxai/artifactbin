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
const WOMAN =
  "M813 264 Q822 259 832 272 L849 293 868 324 Q877 337 885 366 L897 397 898 441 891 481 900 514 905 553 907 619 914 698 897 781 895 811 Q873 830 850 813 L841 794 825 806 Q791 833 749 813 L751 796 768 780 778 698 785 626 779 573 771 548 774 516 Q758 503 769 472 L774 418 783 394 Q769 379 780 345 L789 329 793 323 Q788 308 805 311 L819 319 834 310 832 302 820 292 Z";
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
  const foreground = new Path2D(WOMAN),
    hitContext = document.createElement("canvas").getContext("2d");
  let frame = 0,
    last = 0,
    accumulator = 0,
    visible = true,
    disposed = false,
    gesture: PaperGesture | null = null,
    grabIndex = 0,
    activePointer: number | null = null,
    relaxUntil = 0;
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
    mesh.frustumCulled = false;
    const shadow = new Mesh(
      geo,
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
    c.fillStyle = index % 2 ? "#f7f0dc" : "#fffcf1";
    c.fillRect(0, 0, w, h);
    if (sheet.image.complete && sheet.image.naturalWidth) {
      const margin = 12,
        scale = (w - margin * 2) / sheet.image.naturalWidth,
        dh = sheet.image.naturalHeight * scale;
      c.drawImage(
        sheet.image,
        margin,
        Math.max(12, (h - dh) / 2),
        w - margin * 2,
        dh,
      );
    }
    // A couple of notebook sheets, not six identical punched strips.
    if (index === 0 || index === 3) {
      c.globalCompositeOperation = "destination-out";
      for (let x = 18; x < w - 10; x += 24) {
        c.beginPath();
        c.arc(x, 10, 3.1, 0, Math.PI * 2);
        c.fill();
      }
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
    const front = document.createElement("canvas");
    front.width = 1448;
    front.height = 1086;
    const f = front.getContext("2d");
    if (!f) return;
    f.clip(foreground);
    f.drawImage(background, 0, 0, 1448, 1086);
    const ft = new CanvasTexture(front);
    ft.colorSpace = SRGBColorSpace;
    quad(ft, 65);
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
      const xs = i % 3 === 0 ? [10, p.width - 10] : [p.width * 0.53];
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
      s.lastTorn = s.cloth.torn.size;
    }
    s.mesh.geometry.computeVertexNormals();
    s.mesh.geometry.computeBoundingSphere();
    const lifted = !s.cloth.pinned;
    s.shadow.position.set(lifted ? 9 : 4, lifted ? 11 : 7, -5);
    s.shadow.material.opacity = lifted ? 0.09 : 0.13;
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
          time < relaxUntil
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
          if (reduced.matches && !held && !s.cloth.pinned) s.cloth.age = 4;
          stepCloth(s.cloth, 1 / 60, grab);
          if (wasPinned && !s.cloth.pinned) onReveal(s.paper);
          updateMesh(s);
        }
      }
      accumulator -= 1 / 60;
    }
    moving =
      sheets.some((s) => !s.cloth.pinned && !s.cloth.settled) ||
      !!gesture?.dragging ||
      time < relaxUntil;
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
    const ordered = [...sheets]
      .sort((a, b) => Number(b.cloth.pinned) - Number(a.cloth.pinned))
      .reverse();
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
    const sheet = ordered.find((s) => {
      if (s.cloth.pinned && hitContext?.isPointInPath(foreground, p.x, p.y))
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
        releaseCloth(s.cloth);
        onReveal(s.paper);
      } else if (!cancelled) window.location.assign(s.paper.href);
    }
    canvas.style.cursor = "grab";
    relaxUntil = performance.now() + 900;
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
    for (const s of sheets) {
      resetCloth(s.cloth);
      s.mesh.geometry.setIndex(s.indices);
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
