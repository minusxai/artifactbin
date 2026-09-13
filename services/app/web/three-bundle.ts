/**
 * THE 3D VIEWER'S ONE DEPENDENCY, LOADED ON DEMAND — a deliberate dynamic-import
 * boundary. The app bundle never carries three.js. When a glb is previewed the
 * viewer fetches the SAME served bundle documents use (public/libraries: three
 * plus GLTFLoader and OrbitControls, named by lib/libraries/registry.json), so
 * no other page pays for it and the version cannot drift from the documents'.
 */
import { libraryUrls } from '@/lib/libraries';

interface Vec3 {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): Vec3;
  sub(v: Vec3): Vec3;
}
interface Object3D {
  position: Vec3;
  add(child: Object3D): Object3D;
}
interface Box3 {
  setFromObject(object: Object3D): Box3;
  getSize(target: Vec3): Vec3;
  getCenter(target: Vec3): Vec3;
}

/** The slice of the bundle the viewer touches, typed structurally: `three`
 * ships no types here, and the viewer needs a dozen members, not the API. */
export interface ThreeBundle {
  WebGLRenderer: new (options: { canvas: HTMLCanvasElement; antialias?: boolean; alpha?: boolean }) => {
    setPixelRatio(ratio: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: Object3D, camera: Object3D): void;
    dispose(): void;
  };
  Scene: new () => Object3D;
  PerspectiveCamera: new (fov: number, aspect: number, near: number, far: number) => Object3D & {
    near: number;
    far: number;
    updateProjectionMatrix(): void;
  };
  HemisphereLight: new (sky: number, ground: number, intensity: number) => Object3D;
  DirectionalLight: new (color: number, intensity: number) => Object3D;
  Vector3: new () => Vec3;
  Box3: new () => Box3;
  GLTFLoader: new () => { parseAsync(data: ArrayBuffer, path: string): Promise<{ scene: Object3D }> };
  OrbitControls: new (camera: Object3D, element: HTMLElement) => {
    enableDamping: boolean;
    update(): void;
    dispose(): void;
  };
}

let bundle: Promise<ThreeBundle> | null = null;

export function loadThree(): Promise<ThreeBundle> {
  // The URL is a served asset, not a module for the bundler to resolve.
  bundle ??= import(/* @vite-ignore */ libraryUrls().three ?? '') as Promise<ThreeBundle>;
  return bundle;
}
