import * as THREE from 'three';
import { edgeKey, faceKey, cubeKey } from './GameModel';
import type { EdgeState, FaceState, CubeState } from './types';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const PLAYER_COLORS: Record<string, number> = {
  A: 0x3a6ea5,
  B: 0xc75c5c,
  neutral: 0x7a6555, // warm medium-contrast ink
  hover:   0x2c1408, // dark warm ink — strong contrast on hover
};

const BG_COLOR    = 0xf5f0e8;
const EDGE_RADIUS = 0.04;
const POINT_RADIUS = 0.08;
const FACE_OPACITY = 0.13;
const CUBE_OPACITY = 0.32;

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

// -- Face: noise-varied fill so surfaces don't look sterile --
const FACE_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FACE_FRAG = /* glsl */`
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform vec2  uSeed;
  varying vec2  vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 17.31);
    return fract(p.x * p.y);
  }

  void main() {
    if (uOpacity <= 0.001) discard;
    // tile-based noise so variation reads as material grain, not banding
    float n = hash21(floor(vUv * 22.0) + uSeed);
    float noisy = uOpacity * (0.78 + n * 0.44);
    gl_FragColor = vec4(uColor, clamp(noisy, 0.0, 1.0));
  }
`;

// -- Cube: fresnel rim + noise fill --
const CUBE_VERT = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPos  = modelViewMatrix * vec4(position, 1.0);
    vNormal     = normalize(normalMatrix * normal);
    vViewDir    = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const CUBE_FRAG = /* glsl */`
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform vec2  uSeed;
  varying vec3  vNormal;
  varying vec3  vViewDir;
  varying vec2  vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 17.31);
    return fract(p.x * p.y);
  }

  void main() {
    if (uOpacity <= 0.001) discard;
    // Fresnel rim — brightens edges facing away from camera
    float ndv    = max(dot(vNormal, vViewDir), 0.0);
    float rim    = pow(1.0 - ndv, 2.2);
    // Faint noise to break up flat fill
    float n      = hash21(floor(vUv * 14.0) + uSeed);
    float final  = uOpacity + rim * 0.18 + (n - 0.5) * 0.04;
    gl_FragColor = vec4(uColor, clamp(final, 0.0, 1.0));
  }
`;

// ---------------------------------------------------------------------------
// Helper — build a face ShaderMaterial (per-instance, so uniforms are independent)
// ---------------------------------------------------------------------------
function makeFaceMat(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader:   FACE_VERT,
    fragmentShader: FACE_FRAG,
    uniforms: {
      uColor:   { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.0 },
      uSeed:    { value: new THREE.Vector2(Math.random() * 100, Math.random() * 100) },
    },
    transparent: true,
    depthWrite:  false,
    side:        THREE.DoubleSide,
  });
}

function makeCubeMat(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader:   CUBE_VERT,
    fragmentShader: CUBE_FRAG,
    uniforms: {
      uColor:   { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.0 },
      uSeed:    { value: new THREE.Vector2(Math.random() * 100, Math.random() * 100) },
    },
    transparent: true,
    depthWrite:  false,
  });
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
export class Renderer {
  scene:    THREE.Scene;
  camera:   THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;

  private edgeMeshes    = new Map<string, THREE.Mesh>();
  private edgeHitMeshes = new Map<string, THREE.Mesh>();
  private faceMeshes    = new Map<string, THREE.Mesh>();
  private cubeMeshes    = new Map<string, THREE.Mesh>();

  private sharedSphereGeo:   THREE.SphereGeometry;
  private sharedCylinderGeo: THREE.CylinderGeometry;

  // Shared edge materials (edges don't need per-instance shaders)
  private matNeutralEdge: THREE.MeshStandardMaterial;
  private matHoverEdge:   THREE.MeshStandardMaterial;
  private matPlayerA:     THREE.MeshStandardMaterial;
  private matPlayerB:     THREE.MeshStandardMaterial;
  private matPoint:       THREE.MeshStandardMaterial;

  private hoveredEdgeKey: string | null = null;
  private raycaster = new THREE.Raycaster();
  private validEdgeKeys = new Set<string>();

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);

    const w = canvas.clientWidth || canvas.width || 800;
    const h = canvas.clientHeight || canvas.height || 600;
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = false;

    // Shared geometry (reused across all edge/point meshes)
    this.sharedSphereGeo   = new THREE.SphereGeometry(POINT_RADIUS, 8, 8);
    this.sharedCylinderGeo = new THREE.CylinderGeometry(EDGE_RADIUS, EDGE_RADIUS, 1, 8);

    // Edge materials — MeshStandard gives lighting response without heavy shaders
    this.matNeutralEdge = new THREE.MeshStandardMaterial({
      color: PLAYER_COLORS.neutral, roughness: 0.82, metalness: 0,
    });
    // Hover: slightly dark ink with a faint warm emissive rim — tactile, not flashy
    this.matHoverEdge = new THREE.MeshStandardMaterial({
      color:             0x1e0c04,
      roughness:         0.45,
      metalness:         0,
      emissive:          new THREE.Color(0x8c3a10),
      emissiveIntensity: 0.10,
    });
    this.matPlayerA = new THREE.MeshStandardMaterial({ color: PLAYER_COLORS.A, roughness: 0.65, metalness: 0 });
    this.matPlayerB = new THREE.MeshStandardMaterial({ color: PLAYER_COLORS.B, roughness: 0.65, metalness: 0 });
    this.matPoint   = new THREE.MeshStandardMaterial({ color: 0x5a4535, roughness: 0.82, metalness: 0 });

    this.setupLighting();
    this.setupCamera();
  }

  private setupLighting() {
    // Warm ambient — matches paper background tone
    this.scene.add(new THREE.AmbientLight(0xfff8f0, 0.72));

    // Warm primary from upper-right
    const dir1 = new THREE.DirectionalLight(0xfff5e8, 0.58);
    dir1.position.set(5, 8, 5);
    this.scene.add(dir1);

    // Soft warm fill from lower-left, gives depth
    const dir2 = new THREE.DirectionalLight(0xffe8d0, 0.22);
    dir2.position.set(-4, 2, -4);
    this.scene.add(dir2);
  }

  setupCamera() {
    const target = new THREE.Vector3(1, 1, 1);
    const dist   = 6;
    this.camera.position.set(
      target.x + dist * Math.cos(Math.PI / 6),
      target.y + dist * Math.sin(Math.PI / 4),
      target.z + dist * Math.cos(Math.PI / 6),
    );
    this.camera.lookAt(target);
  }

  // -------------------------------------------------------------------------
  // Scene init
  // -------------------------------------------------------------------------

  initPoints(points: { x: number; y: number; z: number }[]) {
    for (const p of points) {
      const mesh = new THREE.Mesh(this.sharedSphereGeo, this.matPoint);
      mesh.position.set(p.x, p.y, p.z);
      this.scene.add(mesh);
    }
  }

  initEdges(edges: EdgeState[]) {
    for (const { edge } of edges) {
      const key = edgeKey(edge);
      const { mesh, hitMesh } = this.createEdgeMesh(edge);
      mesh.userData    = { edgeKey: key };
      hitMesh.userData = { edgeKey: key };
      this.edgeMeshes.set(key, mesh);
      this.edgeHitMeshes.set(key, hitMesh);
      this.scene.add(mesh);
      this.scene.add(hitMesh);
    }
  }

  private createEdgeMesh(edge: import('./types').Edge): { mesh: THREE.Mesh; hitMesh: THREE.Mesh } {
    const { start, direction } = edge;
    const mid = new THREE.Vector3(
      start.x + (direction === 'x' ? 0.5 : 0),
      start.y + (direction === 'y' ? 0.5 : 0),
      start.z + (direction === 'z' ? 0.5 : 0),
    );

    const mesh = new THREE.Mesh(this.sharedCylinderGeo, this.matNeutralEdge);
    mesh.position.copy(mid);
    if (direction === 'x') mesh.rotation.z = Math.PI / 2;
    else if (direction === 'z') mesh.rotation.x = Math.PI / 2;

    // Enlarged invisible hit zone for comfortable clicking
    const hitGeo  = new THREE.CylinderGeometry(0.18, 0.18, 1, 6);
    const hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
    hitMesh.position.copy(mid);
    if (direction === 'x') hitMesh.rotation.z = Math.PI / 2;
    else if (direction === 'z') hitMesh.rotation.x = Math.PI / 2;

    return { mesh, hitMesh };
  }

  initFaces(faces: FaceState[]) {
    for (const { face } of faces) {
      const key  = faceKey(face);
      const geo  = new THREE.PlaneGeometry(1, 1);
      const mat  = makeFaceMat(); // per-instance — independent uniforms
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 1;

      const { origin, normal } = face;
      mesh.position.set(
        origin.x + (normal !== 'x' ? 0.5 : 0),
        origin.y + (normal !== 'y' ? 0.5 : 0),
        origin.z + (normal !== 'z' ? 0.5 : 0),
      );
      if (normal === 'x') mesh.rotation.y = Math.PI / 2;
      else if (normal === 'y') mesh.rotation.x = Math.PI / 2;

      this.faceMeshes.set(key, mesh);
      this.scene.add(mesh);
    }
  }

  initCubes(cubes: CubeState[]) {
    for (const { cube } of cubes) {
      const key  = cubeKey(cube);
      const geo  = new THREE.BoxGeometry(1, 1, 1);
      const mat  = makeCubeMat(); // per-instance — fresnel + noise uniforms
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      mesh.position.set(cube.origin.x + 0.5, cube.origin.y + 0.5, cube.origin.z + 0.5);

      this.cubeMeshes.set(key, mesh);
      this.scene.add(mesh);
    }
  }

  // -------------------------------------------------------------------------
  // State updates
  // -------------------------------------------------------------------------

  updateEdgeStates(edges: EdgeState[], validEdgeKeys: Set<string>) {
    this.validEdgeKeys = validEdgeKeys;

    for (const { edge, owner } of edges) {
      const key  = edgeKey(edge);
      const mesh = this.edgeMeshes.get(key);
      if (!mesh) continue;

      if (key === this.hoveredEdgeKey && !owner) {
        mesh.material = this.matHoverEdge;
      } else if (owner === 'A') {
        mesh.material = this.matPlayerA;
      } else if (owner === 'B') {
        mesh.material = this.matPlayerB;
      } else {
        mesh.material = this.matNeutralEdge;
      }
    }
  }

  updateFaceStates(faces: FaceState[]) {
    for (const { face, complete, owner } of faces) {
      const mesh = this.faceMeshes.get(faceKey(face));
      if (!mesh) continue;
      const mat = mesh.material as THREE.ShaderMaterial;

      if (complete) {
        (mat.uniforms.uColor.value as THREE.Color).setHex(
          owner === 'A' ? PLAYER_COLORS.A : owner === 'B' ? PLAYER_COLORS.B : 0xaaaaaa
        );
        mat.uniforms.uOpacity.value = FACE_OPACITY;
      } else {
        mat.uniforms.uOpacity.value = 0.0;
      }
    }
  }

  updateCubeStates(cubes: CubeState[]) {
    for (const { cube, complete, owner } of cubes) {
      const mesh = this.cubeMeshes.get(cubeKey(cube));
      if (!mesh) continue;
      const mat = mesh.material as THREE.ShaderMaterial;

      if (complete) {
        (mat.uniforms.uColor.value as THREE.Color).setHex(
          owner === 'A' ? PLAYER_COLORS.A : owner === 'B' ? PLAYER_COLORS.B : 0xaaaaaa
        );
        mat.uniforms.uOpacity.value = CUBE_OPACITY;
      } else {
        mat.uniforms.uOpacity.value = 0.0;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  setHoveredEdge(edgeKeyVal: string | null) {
    this.hoveredEdgeKey = edgeKeyVal;
  }

  getHoveredEdgeKey(): string | null {
    return this.hoveredEdgeKey;
  }

  raycastEdge(ndc: THREE.Vector2): string | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(Array.from(this.edgeHitMeshes.values()));
    for (const hit of hits) {
      const key = hit.object.userData.edgeKey as string;
      if (this.validEdgeKeys.has(key)) return key;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.sharedSphereGeo.dispose();
    this.sharedCylinderGeo.dispose();
    this.renderer.dispose();
  }
}
