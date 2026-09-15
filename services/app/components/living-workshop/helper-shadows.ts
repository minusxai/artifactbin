import {
  Color,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type WebGLRenderer,
} from "three";

/** Project the animated rigid meshes onto each helper's painted support surface.
 * One offscreen silhouette pass avoids dark seams where body parts overlap.
 */
export function createHelperShadows() {
  const silhouettes = new Scene();
  const overlay = new Scene();
  const target = new WebGLRenderTarget(1024, 576, { depthBuffer: false });
  const ink = new MeshBasicMaterial({
    color: 0x000000,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      map: { value: target.texture },
      softness: { value: 1.5 },
      strength: { value: 0.23 },
    },
    vertexShader:
      "varying vec2 uvShadow; void main(){ uvShadow=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader: `
      uniform sampler2D map;
      uniform float softness;
      uniform float strength;
      varying vec2 uvShadow;
      void main() {
        float a=0.0;
        float weight=0.0;
        for(int x=-2; x<=2; x++) for(int y=-2; y<=2; y++) {
          float w=exp(-float(x*x+y*y)*0.5);
          a+=texture2D(map,uvShadow+vec2(float(x)/1024.0,float(y)/576.0)*softness).a*w;
          weight+=w;
        }
        gl_FragColor=vec4(0.16,0.18,0.21,a/weight*strength);
      }
    `,
  });
  const plane = new PlaneGeometry(1448, 815);
  const surface = new Mesh(plane, material);
  surface.position.set(724, 407.5, 1);
  // Camera uses downward-positive scene coordinates.
  surface.scale.y = -1;
  overlay.add(surface);
  const casters: Array<{
    source: Mesh;
    shadow: Mesh;
    floor: number;
    z: number;
    compact: boolean;
  }> = [];
  let outdoors = false;
  const projection = new Matrix4();
  const previousColor = new Color();
  return {
    add(root: Object3D, floor: number, z: number, compact: boolean) {
      root.traverse((source) => {
        if (!(source instanceof Mesh)) return;
        // Screen decals do not add to the exterior silhouette.
        if (
          source.material instanceof MeshBasicMaterial &&
          source.material.transparent
        )
          return;
        const shadow = new Mesh(source.geometry, ink);
        shadow.matrixAutoUpdate = false;
        shadow.frustumCulled = false;
        silhouettes.add(shadow);
        casters.push({ source, shadow, floor, z, compact });
      });
    },
    setEnvironment(name: "indoor" | "outdoor") {
      outdoors = name === "outdoor";
      material.uniforms.softness.value = outdoors ? 2.1 : 1.3;
      material.uniforms.strength.value = outdoors ? 0.17 : 0.24;
    },
    render(renderer: WebGLRenderer, camera: Camera) {
      if (!casters.length) return;
      for (const { source, shadow, floor, z, compact } of casters) {
        source.updateWorldMatrix(true, false);
        const dx = compact ? 0.2 : outdoors ? 0.44 : 0.7;
        const dy = compact ? 0.035 : outdoors ? 0.18 : 0.13;
        projection.set(
          1,
          -dx,
          0,
          dx * floor,
          0,
          -dy,
          0.12,
          floor * (1 + dy) - 0.12 * z,
          0,
          0,
          0,
          2,
          0,
          0,
          0,
          1,
        );
        shadow.matrix.multiplyMatrices(projection, source.matrixWorld);
        shadow.visible = source.visible;
      }
      const previousTarget = renderer.getRenderTarget();
      const autoClear = renderer.autoClear;
      renderer.getClearColor(previousColor);
      const alpha = renderer.getClearAlpha();
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.autoClear = false;
      renderer.render(silhouettes, camera);
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(previousColor, alpha);
      renderer.render(overlay, camera);
      renderer.autoClear = autoClear;
    },
    dispose() {
      target.dispose();
      ink.dispose();
      material.dispose();
      plane.dispose();
      silhouettes.clear();
      overlay.clear();
      casters.length = 0;
    },
  };
}
