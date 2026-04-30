import * as THREE from 'three';
import { edgeKey, faceKey, cubeKey } from './GameModel';
import type { EdgeState, FaceState, CubeState } from './types';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const PLAYER_COLORS: Record<string, number> = {
  A: 0x3575c8, // vivid mid-blue, moderate saturation
  B: 0xc8393a, // vivid mid-red, moderate saturation
};

const BG_COLOR      = 0xf5f0e8; // warm off-white paper
const NEUTRAL_COLOR = 0xb8aa98; // warm gray — used for corner dots
// Neutral edge color: faded further toward the paper BG so the wires
// between nodes read as ghostly guides rather than solid lines.
const NEUTRAL_EDGE_COLOR = 0xded6ca;

// Completed cube cage: player hue lightened ~40% toward white
const COMPLETED_COLOR: Record<string, number> = {
  A: 0x7aaad4,
  B: 0xd48c8e,
};

// Hover: bright amber, always reads as "interactive"
const HOVER_COLOR = 0xe8a030;

// ---------------------------------------------------------------------------
// Geometry radii — four tiers: ghost / cage / mark / interactive
// ---------------------------------------------------------------------------
const RADIUS_NEUTRAL   = 0.011; // ghost structure — recedes completely
const RADIUS_COMPLETED = 0.019; // cage wire on a completed cube — visible but calm
const RADIUS_OWNED     = 0.026; // player mark — reads clearly above neutral
const RADIUS_HOVER     = 0.038; // hover state — unmistakably interactive
const RADIUS_HIGHLIGHT = 0.040; // traveling draw-in dot
const RADIUS_POINT     = 0.038; // corner dots — anchor the grid

// ---------------------------------------------------------------------------
// Animation timings
// ---------------------------------------------------------------------------
const EDGE_ANIM_MS = 160;  // edge draw-in duration (ms)
const EDGE_GLOW_MS = 350;  // post-draw emphasis duration (ms)
const CUBE_ANIM_MS = 400;  // cube scale-in duration (ms)

// ---------------------------------------------------------------------------
// Opacity values
// ---------------------------------------------------------------------------
const FACE_OPACITY = 0.07; // barely-there tint
const CUBE_OPACITY = 0.22; // soft ownership fill

// ---------------------------------------------------------------------------
// Easing helpers
// ---------------------------------------------------------------------------
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Slight scale overshoot: scale goes 0 → ~1.07 → 1
function easeOutBack(t: number): number {
  const k = 1.5;
  return 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
}

// ---------------------------------------------------------------------------
// ShaderMaterials for face fills and cube volumes
// ---------------------------------------------------------------------------
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
    float n     = hash21(floor(vUv * 20.0) + uSeed);
    float noisy = uOpacity * (0.90 + n * 0.20);
    gl_FragColor = vec4(uColor, clamp(noisy, 0.0, 1.0));
  }
`;

// Cube: fresnel rim gives a soft, painterly depth cue
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
    float ndv   = max(dot(vNormal, vViewDir), 0.0);
    float rim   = pow(1.0 - ndv, 2.2);
    float n     = hash21(floor(vUv * 12.0) + uSeed);
    float alpha = uOpacity + rim * 0.16 + (n - 0.5) * 0.025;
    gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 1.0));
  }
`;

function makeFaceMat(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader:   FACE_VERT,
    fragmentShader: FACE_FRAG,
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
    vertexShader:   CUBE_VERT,
    fragmentShader: CUBE_FRAG,
    uniforms: {
      uColor:   { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.0 },
      uSeed:    { value: new THREE.Vector2(Math.random() * 100, Math.random() * 100) },
    },
    transparent: true, depthWrite: false,
  });
}

// ---------------------------------------------------------------------------
// Internal data structures
// ---------------------------------------------------------------------------
interface EdgePosData {
  startPos:   THREE.Vector3;
  dirVec:     THREE.Vector3; // unit vector along edge (length = 1 world unit)
  fullMidPos: THREE.Vector3;
}

interface EdgeAnimState {
  owner:     'A' | 'B';
  startTime: number;
  pos:       EdgePosData;
  highlight: THREE.Mesh;    // traveling spark — removed from scene on completion
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

  // Geometry tiers (shared — never cloned per-mesh, only swapped on material)
  private geoNeutralEdge:   THREE.CylinderGeometry;
  private geoCompletedEdge: THREE.CylinderGeometry;
  private geoOwnedEdge:     THREE.CylinderGeometry;
  private geoHoverEdge:     THREE.CylinderGeometry;
  private geoHighlight:     THREE.SphereGeometry;
  private geoPoint:         THREE.SphereGeometry;

  // Materials
  private matNeutral:    THREE.MeshStandardMaterial;
  private matHover:      THREE.MeshStandardMaterial;
  private matPlayerA:    THREE.MeshStandardMaterial;
  private matPlayerB:    THREE.MeshStandardMaterial;
  private matCompA:      THREE.MeshStandardMaterial; // completed cage, A
  private matCompB:      THREE.MeshStandardMaterial; // completed cage, B
  private matGlowA:      THREE.MeshStandardMaterial; // post-placement emphasis, A
  private matGlowB:      THREE.MeshStandardMaterial;
  private matHighlightA: THREE.MeshStandardMaterial; // traveling draw-in dot, A
  private matHighlightB: THREE.MeshStandardMaterial;
  private matPoint:      THREE.MeshStandardMaterial;

  // Interaction state
  private hoveredEdgeKey:    string | null = null;
  private lastPlacedEdgeKey: string | null = null;
  private lastPlacedTimer    = 0;

  // Edge position data (set at initEdges time, static thereafter)
  private edgePosData = new Map<string, EdgePosData>();

  // Edge draw-in animations — keyed by edgeKey
  private edgeAnims = new Map<string, EdgeAnimState>();

  // Cube scale-in animations — keyed by cubeKey
  private cubeAnimTimes = new Map<string, number>(); // cubeKey → startTime
  private cubeComplete  = new Set<string>();          // tracks which cubes have begun anim

  private raycaster     = new THREE.Raycaster();
  private validEdgeKeys = new Set<string>();

  // ---------------------------------------------------------------------------
  constructor(canvas: HTMLCanvasElement) {
    this.scene      = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);
    // Very subtle linear fog — gives a gentle depth gradient to far board elements
    this.scene.fog  = new THREE.Fog(BG_COLOR, 9, 26);

    const w = canvas.clientWidth  || canvas.width  || 800;
    const h = canvas.clientHeight || canvas.height || 600;
    this.camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 100);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias:       true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = false;

    // Geometries
    this.geoNeutralEdge   = new THREE.CylinderGeometry(RADIUS_NEUTRAL,   RADIUS_NEUTRAL,   1, 6);
    this.geoCompletedEdge = new THREE.CylinderGeometry(RADIUS_COMPLETED, RADIUS_COMPLETED, 1, 6);
    this.geoOwnedEdge     = new THREE.CylinderGeometry(RADIUS_OWNED,     RADIUS_OWNED,     1, 8);
    this.geoHoverEdge     = new THREE.CylinderGeometry(RADIUS_HOVER,     RADIUS_HOVER,     1, 8);
    this.geoHighlight     = new THREE.SphereGeometry(RADIUS_HIGHLIGHT, 8, 8);
    this.geoPoint         = new THREE.SphereGeometry(RADIUS_POINT,     8, 8);

    // Materials
    this.matNeutral = new THREE.MeshStandardMaterial({
      color: NEUTRAL_EDGE_COLOR, roughness: 0.88, metalness: 0,
    });
    this.matHover = new THREE.MeshStandardMaterial({
      color:             HOVER_COLOR,
      roughness:         0.30,
      metalness:         0,
      emissive:          new THREE.Color(0xb06010),
      emissiveIntensity: 0.30,
    });
    this.matPlayerA = new THREE.MeshStandardMaterial({
      color: PLAYER_COLORS.A, roughness: 0.60, metalness: 0.05,
    });
    this.matPlayerB = new THREE.MeshStandardMaterial({
      color: PLAYER_COLORS.B, roughness: 0.60, metalness: 0.05,
    });
    this.matCompA = new THREE.MeshStandardMaterial({
      color: COMPLETED_COLOR.A, roughness: 0.82, metalness: 0,
    });
    this.matCompB = new THREE.MeshStandardMaterial({
      color: COMPLETED_COLOR.B, roughness: 0.82, metalness: 0,
    });
    // Post-placement glow: same hue, lower roughness, slight emissive warmth
    this.matGlowA = new THREE.MeshStandardMaterial({
      color:             PLAYER_COLORS.A,
      roughness:         0.40,
      metalness:         0.05,
      emissive:          new THREE.Color(PLAYER_COLORS.A),
      emissiveIntensity: 0.35,
    });
    this.matGlowB = new THREE.MeshStandardMaterial({
      color:             PLAYER_COLORS.B,
      roughness:         0.40,
      metalness:         0.05,
      emissive:          new THREE.Color(PLAYER_COLORS.B),
      emissiveIntensity: 0.35,
    });
    // Traveling draw-in highlight — bright, high-emissive, small sphere
    this.matHighlightA = new THREE.MeshStandardMaterial({
      color:             0xaaccff,
      roughness:         0.15,
      metalness:         0,
      emissive:          new THREE.Color(PLAYER_COLORS.A),
      emissiveIntensity: 1.1,
    });
    this.matHighlightB = new THREE.MeshStandardMaterial({
      color:             0xffaaaa,
      roughness:         0.15,
      metalness:         0,
      emissive:          new THREE.Color(PLAYER_COLORS.B),
      emissiveIntensity: 1.1,
    });
    this.matPoint = new THREE.MeshStandardMaterial({
      color: NEUTRAL_COLOR, roughness: 0.88, metalness: 0,
    });

    this.setupLighting();
    this.setupCamera();
  }

  // ---------------------------------------------------------------------------
  private setupLighting() {
    // Warm ambient — fills shadows without killing form
    this.scene.add(new THREE.AmbientLight(0xfff8f0, 0.68));

    // Primary: upper-left warm key light
    const key = new THREE.DirectionalLight(0xfff8ec, 0.65);
    key.position.set(4, 9, 5);
    this.scene.add(key);

    // Secondary: soft fill from the opposite side, slightly cooler
    const fill = new THREE.DirectionalLight(0xdde8ff, 0.22);
    fill.position.set(-5, 2, -4);
    this.scene.add(fill);

    // Bottom bounce — simulates paper-on-table ambient bounce
    const bounce = new THREE.DirectionalLight(0xfff0d8, 0.10);
    bounce.position.set(0, -4, 0);
    this.scene.add(bounce);
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

  // ---------------------------------------------------------------------------
  // Scene initialisation
  // ---------------------------------------------------------------------------
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
      const { mesh, hitMesh, posData } = this.createEdgeMesh(edge);
      mesh.userData    = { edgeKey: key };
      hitMesh.userData = { edgeKey: key };
      this.edgeMeshes.set(key, mesh);
      this.edgeHitMeshes.set(key, hitMesh);
      this.edgePosData.set(key, posData);
      this.scene.add(mesh);
      this.scene.add(hitMesh);
    }
  }

  private createEdgeMesh(edge: import('./types').Edge): {
    mesh: THREE.Mesh;
    hitMesh: THREE.Mesh;
    posData: EdgePosData;
  } {
    const { start, direction } = edge;

    const startPos = new THREE.Vector3(start.x, start.y, start.z);
    const dirVec   = new THREE.Vector3(
      direction === 'x' ? 1 : 0,
      direction === 'y' ? 1 : 0,
      direction === 'z' ? 1 : 0,
    );
    const fullMidPos = startPos.clone().addScaledVector(dirVec, 0.5);

    const mesh = new THREE.Mesh(this.geoNeutralEdge, this.matNeutral);
    mesh.position.copy(fullMidPos);
    if (direction === 'x') mesh.rotation.z = Math.PI / 2;
    else if (direction === 'z') mesh.rotation.x = Math.PI / 2;

    const hitGeo  = new THREE.CylinderGeometry(0.18, 0.18, 1, 6);
    const hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
    hitMesh.position.copy(fullMidPos);
    if (direction === 'x') hitMesh.rotation.z = Math.PI / 2;
    else if (direction === 'z') hitMesh.rotation.x = Math.PI / 2;

    return { mesh, hitMesh, posData: { startPos, dirVec, fullMidPos } };
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

  // ---------------------------------------------------------------------------
  // State updates — called from Game.syncRendererWithState
  // ---------------------------------------------------------------------------
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

      // Skip edges currently in a draw-in animation — tick() owns them
      if (this.edgeAnims.has(key)) continue;

      if (key === this.hoveredEdgeKey && !owner) {
        // ① Hover — interactive signal
        mesh.geometry = this.geoHoverEdge;
        mesh.material = this.matHover;

      } else if (key === this.lastPlacedEdgeKey && owner) {
        // ② Post-placement glow (timer running)
        mesh.geometry = this.geoOwnedEdge;
        mesh.material = owner === 'A' ? this.matGlowA : this.matGlowB;

      } else if (completedCubeEdgeOwner.has(key)) {
        // ③ Cage wire of a completed cube — lighter, calmer
        const cubeOwner = completedCubeEdgeOwner.get(key)!;
        mesh.geometry = this.geoCompletedEdge;
        mesh.material = cubeOwner === 'A' ? this.matCompA : this.matCompB;

      } else if (owner === 'A') {
        // ④ Owned mid-game — full player mark
        mesh.geometry = this.geoOwnedEdge;
        mesh.material = this.matPlayerA;

      } else if (owner === 'B') {
        mesh.geometry = this.geoOwnedEdge;
        mesh.material = this.matPlayerB;

      } else {
        // ⑤ Neutral / unplayed — ghost structure
        mesh.geometry = this.geoNeutralEdge;
        mesh.material = this.matNeutral;
      }

      // Ensure scale is restored (may have been modified during a prior animation)
      mesh.scale.y = 1;
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
      const key  = cubeKey(cube);
      const mesh = this.cubeMeshes.get(key);
      if (!mesh) continue;
      const mat = mesh.material as THREE.ShaderMaterial;

      if (complete) {
        (mat.uniforms.uColor.value as THREE.Color).setHex(
          owner === 'A' ? PLAYER_COLORS.A : owner === 'B' ? PLAYER_COLORS.B : 0xaaaaaa
        );
        mat.uniforms.uOpacity.value = CUBE_OPACITY;

        if (!this.cubeComplete.has(key)) {
          // Newly completed — trigger scale-in animation
          this.cubeComplete.add(key);
          this.cubeAnimTimes.set(key, performance.now());
          mesh.scale.setScalar(0.01); // start from near-zero
        }
      } else {
        mat.uniforms.uOpacity.value = 0.0;
        // Reset if this cube reverted to incomplete (e.g. undo / reset)
        if (this.cubeComplete.has(key)) {
          this.cubeComplete.delete(key);
          this.cubeAnimTimes.delete(key);
          mesh.scale.setScalar(1);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------
  setHoveredEdge(edgeKeyVal: string | null) {
    this.hoveredEdgeKey = edgeKeyVal;
  }

  getHoveredEdgeKey(): string | null {
    return this.hoveredEdgeKey;
  }

  /**
   * Begin the draw-in animation for a freshly placed edge.
   * Replaces the old setLastPlacedEdge — the glow phase starts automatically
   * once the 160 ms draw-in animation completes.
   */
  beginEdgePlaceAnim(key: string, owner: 'A' | 'B') {
    const mesh    = this.edgeMeshes.get(key);
    const posData = this.edgePosData.get(key);
    if (!mesh || !posData) return;

    // Cancel any previous animation on this key
    const prev = this.edgeAnims.get(key);
    if (prev) {
      this.scene.remove(prev.highlight);
      this.edgeAnims.delete(key);
    }

    // Apply draw material immediately
    mesh.geometry = this.geoOwnedEdge;
    mesh.material = owner === 'A' ? this.matGlowA : this.matGlowB;

    // Start at the edge's begin point with near-zero length
    mesh.position.copy(posData.startPos);
    mesh.scale.y = 0.001;

    // Traveling highlight spark
    const highlight = new THREE.Mesh(
      this.geoHighlight,
      owner === 'A' ? this.matHighlightA : this.matHighlightB,
    );
    highlight.position.copy(posData.startPos);
    this.scene.add(highlight);

    this.edgeAnims.set(key, {
      owner, startTime: performance.now(), pos: posData, highlight,
    });
  }

  /** Call on undo or reset — cancels active animations and clears glow state. */
  clearLastPlaced() {
    // Cancel all in-flight edge animations and reset their meshes
    for (const [key, anim] of this.edgeAnims) {
      this.scene.remove(anim.highlight);
      const mesh = this.edgeMeshes.get(key);
      if (mesh) {
        mesh.scale.y = 1;
        const pos = this.edgePosData.get(key);
        if (pos) mesh.position.copy(pos.fullMidPos);
      }
    }
    this.edgeAnims.clear();

    // Clear glow timer; the timeout callback checks lastPlacedEdgeKey before acting
    this.lastPlacedEdgeKey = null;
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

  // ---------------------------------------------------------------------------
  // Animation ticks (called every frame from tick())
  // ---------------------------------------------------------------------------
  private tickEdgeAnims(now: number) {
    for (const [key, anim] of this.edgeAnims) {
      const mesh = this.edgeMeshes.get(key);
      if (!mesh) { this.edgeAnims.delete(key); continue; }

      const raw = Math.min((now - anim.startTime) / EDGE_ANIM_MS, 1);
      const p   = easeOutCubic(raw);

      // Grow the cylinder from startPos toward fullMidPos
      mesh.position
        .copy(anim.pos.startPos)
        .addScaledVector(anim.pos.dirVec, 0.5 * p);
      mesh.scale.y = Math.max(0.001, p);

      // Highlight spark rides the leading edge
      anim.highlight.position
        .copy(anim.pos.startPos)
        .addScaledVector(anim.pos.dirVec, p);

      if (raw >= 1) {
        // Animation complete — settle into resting state
        mesh.position.copy(anim.pos.fullMidPos);
        mesh.scale.y = 1;

        this.scene.remove(anim.highlight);
        this.edgeAnims.delete(key);

        // Begin the post-placement glow phase
        window.clearTimeout(this.lastPlacedTimer);
        this.lastPlacedEdgeKey = key;

        this.lastPlacedTimer = window.setTimeout(() => {
          if (this.lastPlacedEdgeKey !== key) return;
          const m = this.edgeMeshes.get(key);
          if (m) {
            m.material = anim.owner === 'A' ? this.matPlayerA : this.matPlayerB;
          }
          this.lastPlacedEdgeKey = null;
        }, EDGE_GLOW_MS);
      }
    }
  }

  private tickCubeAnims(now: number) {
    for (const [key, startTime] of this.cubeAnimTimes) {
      const mesh = this.cubeMeshes.get(key);
      if (!mesh) { this.cubeAnimTimes.delete(key); continue; }

      const t = Math.min((now - startTime) / CUBE_ANIM_MS, 1);
      if (t >= 1) {
        mesh.scale.setScalar(1);
        this.cubeAnimTimes.delete(key);
      } else {
        // easeOutBack gives a gentle scale overshoot (~6-7%) then settles
        mesh.scale.setScalar(Math.max(0.01, easeOutBack(t)));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Main loop — called every frame from Game.ts instead of render()
  // ---------------------------------------------------------------------------
  tick(now: number) {
    this.tickEdgeAnims(now);
    this.tickCubeAnims(now);
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose() {
    window.clearTimeout(this.lastPlacedTimer);
    for (const anim of this.edgeAnims.values()) this.scene.remove(anim.highlight);
    this.edgeAnims.clear();
    this.geoNeutralEdge.dispose();
    this.geoCompletedEdge.dispose();
    this.geoOwnedEdge.dispose();
    this.geoHoverEdge.dispose();
    this.geoHighlight.dispose();
    this.geoPoint.dispose();
    this.renderer.dispose();
  }
}
