'use client';

/**
 * A glb on a canvas you can orbit. Lights, a camera framed on the model's
 * bounding box, damped orbit controls — the same recipe the markup-libraries
 * reference teaches documents, with the bundle loaded lazily (web/three-bundle)
 * the first time one is shown.
 *
 * THE MODEL IS PARSED FROM BYTES, never loaded by URL. A picked file is a
 * Blob the page already holds, and the app's `connect-src` (server/app) is
 * `'self'` — a loader fetching an object URL would be refused. A stored model
 * is a same-origin address, fetched here once and parsed the same way.
 */
import { useEffect, useRef, useState } from 'react';
import { loadThree } from '@/web/three-bundle';

export default function ModelPreview({ source, title }: { source: Blob | string; title: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
        const { scene: model } = await new THREE.GLTFLoader().parseAsync(bytes, '');
        if (disposed) return;
        // Centre the model and back the camera off by its largest dimension,
        // so a chair and a city block both arrive filling the frame.
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

        const loop = () => {
          frame = requestAnimationFrame(loop);
          orbit.update();
          gl.render(scene, camera);
        };
        loop();
        setStatus('ready');
      } catch {
        if (!disposed) setStatus('error');
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      controls?.dispose();
      renderer?.dispose();
    };
  }, [source]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        aria-label={`3D preview of ${title}`}
        className="h-96 w-full rounded-lg border border-edge bg-raised/40"
      />
      {status !== 'ready' && (
        <p role="status" className="absolute inset-x-0 bottom-2 text-center font-mono text-[11px] text-muted">
          {status === 'loading' ? 'loading 3D preview…' : 'could not load this model for preview'}
        </p>
      )}
      {status === 'ready' && (
        <p className="absolute right-2 bottom-2 font-mono text-[10px] text-faint">drag to orbit · scroll to zoom</p>
      )}
    </div>
  );
}
