import * as THREE from 'three';
import { edgeKey, faceKey, cubeKey } from './GameModel';
import type { EdgeState, FaceState, CubeState } from './types';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const PLAYER_COLORS: Record<string, number> = {
  A: 0x3a6ea5,
  B: 0xc75c5c,
};

const BG_COLOR = 0xf5f0e8;

// Neutral structure — very light warm gray, recedes behind player marks
const NEUTRAL_COLOR = 0xc2b5a5;

// ---------------------------------------------------------------------------
// Geometry sizes — four visual tiers
// ---------------------------------------------------------------------------
const RADIUS_NEUTRAL   = 0.022; // thin  — unowned guide, recedes
const RADIUS_COMPLETED = 0.028; // slim  — completed cube cage, visible but calm
const RADIUS_OWNED     = 0.038; // medium— fully owned mid-game edge, reads clearly
const RADIUS_HOVER     = 0.052; // thick — unmistakably interactive
const RADIUS_POINT     = 0.042; // smaller joints

// ---------------------------------------------------------------------------
// Opacity values
// ---------------------------------------------------------------------------
const FACE_OPACITY = 0.07; // barely-there tint
const CUBE_OPACITY = 0.20; // soft fill, not fog

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

// Face: minimal noise variation so fills support readability without cluttering
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
    // Very light noise — just enough to feel organic, not noticeable
    float n     = hash21(floor(vUv * 20.0) + uSeed);
    float noisy = uOpacity * (0.90 + n * 0.20);
    gl_FragColor = vec4(uColor, clamp(noisy, 0.0, 1.0));
  }
`;

// Cube: fresnel rim for soft depth cue, minimal noise
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
    float ndv    = max(dot(vNormal, vViewDir), 0.0);
    float rim    = pow(1.0 - ndv, 2.2);
    float n      = hash21(floor(vUv * 12.0) + uSeed);
    float final  = uOpacity + rim * 0.14 + (n - 0.5) * 0.025;
    gl_FragColor = vec4(uColor, clamp(final, 0.0, 1.0));
  }
`;

// ---------------------------------------------------------------------------
// Helpers — per-instance transparent ShaderMaterials
// ---------------------------------------------------------------------------
function makeFaceMat(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FACE_VERT, fragmentShader: FACE_FRAG,
    uniforms: {
      uColor:   { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.0 },
      uSeed:    { value: new THREE.Vector2(Math.random() * 100, Math.random() * 100) },
    },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

function makeCubeMat(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: CUBE_VERT, fragmentShader: CUBE_FRAG,
    uniforms: {
      uColor:   { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.0 },
      uSeed:    { value: new THREE.Vector2(Math.random() * 100, Math.random() * 100) },
    },
    transparent: true, depthWrite: false,
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

  // Geometry tiers — shared, never disposed until renderer.dispose()
  private geoNeutralEdge:   THREE.CylinderGeometry; // thin  — unowned playable guide
  private geoCompletedEdge: THREE.CylinderGeometry; // slim  — completed cube cage
  private geoOwnedEdge:     THREE.CylinderGeometry; // medium— fully owned, not yet in complete cube
  private geoHoverEdge:     THREE.CylinderGeometry; // thick — hover / interaction signal
  private geoPoint:         THREE.SphereGeometry;

  // Edge materials
  private matNeutralEdge:    THREE.MeshStandardMaterial;
  private matHoverEdge:      THREE.MeshStandardMaterial; // bright amber — max clarity
  private matPlayerA:        THREE.MeshStandardMaterial; // full player color (mid-game owned)
  private matPlayerB:        THREE.MeshStandardMaterial;
  private matCompletedEdgeA: THREE.MeshStandardMaterial; // lighter cage color for completed cubes
  private matCompletedEdgeB: THREE.MeshStandardMaterial;
  private matLastA:          THREE.MeshStandardMaterial; // brief post-place emphasis
  private matLastB:          THREE.MeshStandardMaterial;
  private matPoint:       THREE.MeshStandardMaterial;

  // Interaction state
  private hoveredEdgeKey:    string | null = null;
  private lastPlacedEdgeKey: string | null = null;
  private lastPlacedTimer    = 0;

  private raycaster     = new THREE.Raycaster();
  private validEdgeKeys = new Set<string>();

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);

    const w = canvas.clientWidth || canvas.width || 800;
    const h = canvas.clientHeight || canvas.height || 600;
    this.camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 100);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = false;

    // -- Geometry tiers --
    this.geoNeutralEdge   = new THREE.CylinderGeometry(RADIUS_NEUTRAL,   RADIUS_NEUTRAL,   1, 6);
    this.geoCompletedEdge = new THREE.CylinderGeometry(RADIUS_COMPLETED, RADIUS_COMPLETED, 1, 7);
    this.geoOwnedEdge     = new THREE.CylinderGeometry(RADIUS_OWNED,     RADIUS_OWNED,     1, 8);
    this.geoHoverEdge     = new THREE.CylinderGeometry(RADIUS_HOVER,     RADIUS_HOVER,     1, 8);
    this.geoPoint         = new THREE.SphereGeometry(RADIUS_POINT, 8, 8);

    // -- Materials --
    this.matNeutralEdge = new THREE.MeshStandardMaterial({
      color: NEUTRAL_COLOR, roughness: 0.85, metalness: 0,
    });
    // Bright warm amber — unmistakably interactive
    this.matHoverEdge = new THREE.MeshStandardMaterial({
      color:             0xe8a030,
      roughness:         0.32,
      metalness:         0,
      emissive:          new THREE.Color(0xc07010),
      emissiveIntensity: 0.28,
    });
    this.matPlayerA = new THREE.MeshStandardMaterial({ color: PLAYER_COLORS.A, roughness: 0.65, metalness: 0 });
    this.matPlayerB = new THREE.MeshStandardMaterial({ color: PLAYER_COLORS.B, roughness: 0.65, metalness: 0 });
    // Completed cube cage — same hue family, lightened ~40% toward white so the
    // cube volume (filled box) carries the ownership signal, not the cage wires.
    // A: #3a6ea5 → lightened → ~#88a8c8   B: #c75c5c → lightened → ~#dc9898
    this.matCompletedEdgeA = new THREE.MeshStandardMaterial({ color: 0x88a8c8, roughness: 0.80, metalness: 0 });
    this.matCompletedEdgeB = new THREE.MeshStandardMaterial({ color: 0xdc9898, roughness: 0.80, metalness: 0 });
    // Brief post-placement brightness — same hue, slight emissive
    this.matLastA = new THREE.MeshStandardMaterial({
      color:             PLAYER_COLORS.A,
      roughness:         0.45,
      metalness:         0,
      emissive:          new THREE.Color(PLAYER_COLORS.A),
      emissiveIntensity: 0.28,
    });
    this.matLastB = new THREE.MeshStandardMaterial({
      color:             PLAYER_COLORS.B,
      roughness:         0.45,
      metalness:         0,
      emissive:          new THREE.Color(PLAYER_COLORS.B),
      emissiveIntensity: 0.28,
    });
    this.matPoint = new THREE.MeshStandardMaterial({
      color: NEUTRAL_COLOR, roughness: 0.85, metalness: 0,
    });

    this.setupLighting();
    this.setupCamera();
  }

  private setupLighting() {
    this.scene.add(new THREE.AmbientLight(0xfff8f0, 0.72));

    const dir1 = new THREE.DirectionalLight(0xfff5e8, 0.58);
    dir1.position.set(5, 8, 5);
    this.scene.add(dir1);

    const dir2 = new THREE.DirectionalLight(0xffe8d0, 0.22);
    dir2.position.set(-4, 2, -4);
    this.scene.add(dir2);
  }

  setupCamera() {
    const target = new THREE.Vector3(1, 1, 1);
    const dist   = 7;
    const elev   = Math.PI / 4;
    this.camera.position.set(
      target.x + dist * Math.cos(elev) * Math.sin(Math.PI / 4),
      target.y + dist * Math.sin(elev),
      target.z + dist * Math.cos(elev) * Math.cos(Math.PI / 4),
    );
    this.camera.lookAt(target);
  }

  // -------------------------------------------------------------------------
  // Scene init
  // -------------------------------------------------------------------------

  initPoints(points: { x: number; y: number; z: number }[]) {
    for (const p of points) {
      const mesh = new THREE.Mesh(this.geoPoint, this.matPoint);
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

    const mesh = new THREE.Mesh(this.geoNeutralEdge, this.matNeutralEdge);
    mesh.position.copy(mid);
    if (direction === 'x') mesh.rotation.z = Math.PI / 2;
    else if (direction === 'z') mesh.rotation.x = Math.PI / 2;

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
      const mat  = makeFaceMat();
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
      const mat  = makeCubeMat();
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

  updateEdgeStates(
    edges: EdgeState[],
    validEdgeKeys: Set<string>,
    completedCubeEdgeOwner: Map<string, 'A' | 'B'>,
  ) {
    this.validEdgeKeys = validEdgeKeys;

    for (const { edge, owner } of edges) {
      const key  = edgeKey(edge);
      const mesh = this.edgeMeshes.get(key);
      if (!mesh) continue;

      if (key === this.hoveredEdgeKey && !owner) {
        // ① Hover — thickest + bright amber, unmistakably interactive
        mesh.geometry = this.geoHoverEdge;
        mesh.material = this.matHoverEdge;

      } else if (key === this.lastPlacedEdgeKey && owner) {
        // ② Just placed — brief emissive flash before settling
        mesh.geometry = this.geoOwnedEdge;
        mesh.material = owner === 'A' ? this.matLastA : this.matLastB;

      } else if (completedCubeEdgeOwner.has(key)) {
        // ③ Part of a completed cube — slim cage wire in the cube owner's
        //    lightened hue.  The filled box volume carries the ownership
        //    signal; the cage should recede and not compete with playable edges.
        const cubeOwner = completedCubeEdgeOwner.get(key)!;
        mesh.geometry = this.geoCompletedEdge;
        mesh.material = cubeOwner === 'A' ? this.matCompletedEdgeA : this.matCompletedEdgeB;

      } else if (owner === 'A') {
        // ④ Owned, mid-game (not yet in a complete cube) — full player color
        mesh.geometry = this.geoOwnedEdge;
        mesh.material = this.matPlayerA;

      } else if (owner === 'B') {
        mesh.geometry = this.geoOwnedEdge;
        mesh.material = this.matPlayerB;

      } else {
        // ⑤ Neutral / unplayed — thin pale guide, recedes completely
        mesh.geometry = this.geoNeutralEdge;
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
  // Interaction
  // -------------------------------------------------------------------------

  setHoveredEdge(edgeKeyVal: string | null) {
    this.hoveredEdgeKey = edgeKeyVal;
  }

  getHoveredEdgeKey(): string | null {
    return this.hoveredEdgeKey;
  }

  /**
   * Call immediately after an edge is placed.
   * Applies a brief emissive emphasis then reverts to the normal player material.
   */
  setLastPlacedEdge(key: string, owner: 'A' | 'B') {
    // Cancel previous timer (it would be a no-op anyway, but be explicit)
    window.clearTimeout(this.lastPlacedTimer);
    this.lastPlacedEdgeKey = key;

    const mesh = this.edgeMeshes.get(key);
    if (mesh) {
      mesh.geometry = this.geoOwnedEdge;
      mesh.material = owner === 'A' ? this.matLastA : this.matLastB;
    }

    this.lastPlacedTimer = window.setTimeout(() => {
      if (this.lastPlacedEdgeKey !== key) return; // superseded
      const m = this.edgeMeshes.get(key);
      if (m) {
        m.geometry = this.geoOwnedEdge;
        m.material = owner === 'A' ? this.matPlayerA : this.matPlayerB;
      }
      this.lastPlacedEdgeKey = null;
    }, 1000);
  }

  /** Call on undo or reset so a stale timer can't corrupt state. */
  clearLastPlaced() {
    this.lastPlacedEdgeKey = null;
    // Leave timer running — it checks lastPlacedEdgeKey === key before acting
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
    window.clearTimeout(this.lastPlacedTimer);
    this.geoNeutralEdge.dispose();
    this.geoCompletedEdge.dispose();
    this.geoOwnedEdge.dispose();
    this.geoHoverEdge.dispose();
    this.geoPoint.dispose();
    this.renderer.dispose();
  }
}
