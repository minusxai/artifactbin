/* @jsxImportSource solid-js */
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { loadThree } from '@/solid/lib/three-bundle';

export default function ModelPreview(props: { source: Blob | string; title: string }): JSX.Element {
  let canvas!: HTMLCanvasElement;
  const [status, setStatus] = createSignal<'loading' | 'ready' | 'error'>('loading');
  createEffect(() => {
    const source = props.source;
    let disposed = false;
    let frame = 0;
    let renderer: { dispose(): void } | null = null;
    let controls: { dispose(): void } | null = null;
    setStatus('loading');
    void (async () => {
      try {
        const THREE = await loadThree();
        if (disposed) return;
        const width = canvas.clientWidth || 640;
        const height = canvas.clientHeight || 384;
        const gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer = gl;
        gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        gl.setSize(width, height, false);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 3));
        const sun = new THREE.DirectionalLight(0xffffff, 2);
        sun.position.set(3, 5, 4);
        scene.add(sun);
        const bytes = typeof source === 'string' ? await (await fetch(source)).arrayBuffer() : await source.arrayBuffer();
        if (disposed) return;
        const loader = new THREE.GLTFLoader();
        // Optimized exports (gltfpack, gltf-transform) compress their geometry with meshopt.
        loader.setMeshoptDecoder(THREE.MeshoptDecoder);
        const { scene: model } = await loader.parseAsync(bytes, '');
        if (disposed) return;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const radius = Math.max(size.x, size.y, size.z) || 1;
        model.position.sub(center);
        scene.add(model);
        camera.position.set(radius * 0.9, radius * 0.7, radius * 1.6);
        camera.near = radius / 100;
        camera.far = radius * 100;
        camera.updateProjectionMatrix();
        const orbit = new THREE.OrbitControls(camera, canvas);
        orbit.enableDamping = true;
        controls = orbit;
        const loop = () => { frame = requestAnimationFrame(loop); orbit.update(); gl.render(scene, camera); };
        loop();
        setStatus('ready');
      } catch { if (!disposed) setStatus('error'); }
    })();
    onCleanup(() => { disposed = true; cancelAnimationFrame(frame); controls?.dispose(); renderer?.dispose(); });
  });
  return <div class="relative">
    <canvas ref={canvas} aria-label={`3D preview of ${props.title}`} class="h-96 w-full rounded-lg border border-edge bg-raised/40" />
    <Show when={status() !== 'ready'}><p role="status" class="absolute inset-x-0 bottom-2 text-center font-mono text-[11px] text-muted">{status() === 'loading' ? 'loading 3D preview…' : 'could not load this model for preview'}</p></Show>
    <Show when={status() === 'ready'}><p class="absolute right-2 bottom-2 font-mono text-[10px] text-faint">drag to orbit · scroll to zoom</p></Show>
  </div>;
}
