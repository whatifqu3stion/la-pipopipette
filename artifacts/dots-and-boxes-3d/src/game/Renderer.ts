import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass }      from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass }     from 'three/examples/jsm/postprocessing/OutputPass.js';
import { edgeKey, faceKey, cubeKey } from './GameModel';
import type { EdgeState, FaceState, CubeState } from './types';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const PLAYER_COLORS: Record<string, number> = {
  A: 0x2a82e0, // peppy saturated blue
  B: 0xe33334, // peppy saturated red
};

const BG_COLOR      = 0xf5f0e8; // warm off-white paper
const NEUTRAL_COLOR = 0xa8987f; // warm gray — used for corner dots (slightly darker for crisper read)
// Neutral edge color: a muted warm gray that reads clearly as grid
// structure but stays subordinate to played edges. Combined with a lit
// matte material + scene fog, front-facing edges pick up subtle key-light
// brightness while back-facing edges fade toward the paper background —
// giving strong depth separation without changing thickness.
const NEUTRAL_EDGE_COLOR = 0xb8a890;

// Completed cube cage: player hue lightened ~40% toward white so the cage
// reads as "owned but settled" without competing with active play moves.
const COMPLETED_COLOR: Record<string, number> = {
  A: 0x80b4ec,
  B: 0xee8586,
};

// Hover: bright amber, always reads as "interactive"
const HOVER_COLOR = 0xe8a030;

// ---------------------------------------------------------------------------
// Geometry radii — four tiers: ghost / cage / mark / interactive
// ---------------------------------------------------------------------------
const RADIUS_NEUTRAL   = 0.014; // grid guide — readable but subordinate to played
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

  // Camera-relative rim/back light (position updated every frame)
  private rimLight!: THREE.DirectionalLight;

  // Postprocessing — provides a real lens-style depth-of-field blur via
  // BokehPass. The pass's `focus` uniform is updated every frame in tick()
  // to follow the camera's distance to the cube center, so the focal plane
  // sits on the cube no matter how far in/out the user has zoomed.
  private composer!: EffectComposer;
  private bokehPass!: BokehPass;
  private composerTarget!: THREE.WebGLRenderTarget;

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
    // Linear fog — initial range is a sensible default for the fallback
    // camera distance (~7 units). The actual near/far values are recomputed
    // every frame in tick() relative to the current camera distance, so the
    // fade always wraps the cube no matter how far the user has zoomed in.
    this.scene.fog  = new THREE.Fog(BG_COLOR, 5, 9);

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
    // Neutral (unplayed) edges use a lit, very matte material with mild
    // transparency. Front-facing edges pick up the warm key light and read
    // crisply; back-facing edges receive only hemisphere light AND get
    // dimmed by scene fog (see fog setup) — together producing strong
    // depth separation without changing thickness.
    this.matNeutral = new THREE.MeshStandardMaterial({
      color:       NEUTRAL_EDGE_COLOR,
      roughness:   0.95,
      metalness:   0,
      transparent: true,
      opacity:     0.85,
      depthWrite:  false,
    });
    this.matHover = new THREE.MeshStandardMaterial({
      color:             HOVER_COLOR,
      roughness:         0.30,
      metalness:         0,
      emissive:          new THREE.Color(0xb06010),
      emissiveIntensity: 0.20,
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
      emissiveIntensity: 0.22,
    });
    this.matGlowB = new THREE.MeshStandardMaterial({
      color:             PLAYER_COLORS.B,
      roughness:         0.40,
      metalness:         0.05,
      emissive:          new THREE.Color(PLAYER_COLORS.B),
      emissiveIntensity: 0.22,
    });
    // Traveling draw-in highlight — bright, high-emissive, small sphere.
    // Light tint of the player hue so the spark reads as "their color" but
    // bright enough to pop against the rest of the board.
    this.matHighlightA = new THREE.MeshStandardMaterial({
      color:             0xb8d8ff,
      roughness:         0.15,
      metalness:         0,
      emissive:          new THREE.Color(PLAYER_COLORS.A),
      emissiveIntensity: 0.7,
    });
    this.matHighlightB = new THREE.MeshStandardMaterial({
      color:             0xffb8b8,
      roughness:         0.15,
      metalness:         0,
      emissive:          new THREE.Color(PLAYER_COLORS.B),
      emissiveIntensity: 0.7,
    });
    this.matPoint = new THREE.MeshStandardMaterial({
      color: NEUTRAL_COLOR, roughness: 0.88, metalness: 0,
    });

    this.setupLighting();
    this.setupCamera();
    this.setupPostprocessing(w, h);
  }

  // ---------------------------------------------------------------------------
  // Postprocessing pipeline:
  //   RenderPass (scene → MSAA target)
  //   BokehPass  (lens-style depth-of-field blur, focus tracks camera)
  //   OutputPass (linear → sRGB conversion at the very end)
  //
  // The composer's render target is multisampled (samples = 4 on WebGL2) so
  // we don't lose antialiasing by going through postprocessing.
  // ---------------------------------------------------------------------------
  private setupPostprocessing(w: number, h: number) {
    const dpr = this.renderer.getPixelRatio();
    this.composerTarget = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(w * dpr)),
      Math.max(1, Math.floor(h * dpr)),
      { samples: 4, type: THREE.HalfFloatType },
    );
    this.composer = new EffectComposer(this.renderer, this.composerTarget);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);

    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Bokeh — focus is set per-frame in tick() so it follows the cube.
    // Aperture controls how strong the blur grows with distance from focus;
    // maxblur clamps the total blur radius (in normalized screen units).
    this.bokehPass = new BokehPass(this.scene, this.camera, {
      focus:    7,        // overwritten per-frame
      aperture: 0.0018,   // moderate — soft, lens-like
      maxblur:  0.012,    // visible but not destructive to readability
    });
    // BokehPass shader takes aspect from a uniform; keep it in sync on resize.
    (this.bokehPass.uniforms as Record<string, THREE.IUniform>).aspect.value = w / h;
    this.composer.addPass(this.bokehPass);

    // Linear → sRGB conversion (required when going through postprocessing
    // since intermediate buffers are linear-space).
    this.composer.addPass(new OutputPass());
  }

  // ---------------------------------------------------------------------------
  private setupLighting() {
    // Hemisphere — warm sky / cool-warm ground baseline. Replaces the previous
    // ambient + bounce pair: hemisphere illumination is naturally direction-
    // aware (sky color from above, ground color from below) so the scene reads
    // well even when the camera rotates to view the cube from below.
    // All intensities pulled back ~25–30% so the player hues read calmer —
    // the previous setup was washing the saturated blue/red into "too hot".
    this.scene.add(new THREE.HemisphereLight(0xfff5e0, 0xe8d8c0, 0.40));

    // Primary key — warm directional from upper-front. Defines main form
    // and gives front-facing surfaces visibly higher brightness than back.
    const key = new THREE.DirectionalLight(0xfff8ec, 0.40);
    key.position.set(5, 8, 4);
    this.scene.add(key);

    // Cool fill from the opposite side — soft counter that prevents shadows
    // from going completely flat without competing with the key.
    const fill = new THREE.DirectionalLight(0xdde8ff, 0.13);
    fill.position.set(-4, 3, -3);
    this.scene.add(fill);

    // Camera-relative rim light — its position is updated every frame in
    // tick() to sit opposite the camera, so it always silhouettes the back
    // of the structure and helps separate edges from the paper background.
    this.rimLight = new THREE.DirectionalLight(0xeaf2ff, 0.20);
    this.rimLight.position.set(-5, 3, -5);
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target); // required so position changes take effect
  }

  // ---------------------------------------------------------------------------
  // Move the rim light to the world position opposite the camera (mirrored
  // through the cube center, with a small upward bias). Called every frame
  // so the rim always catches the back-facing silhouette as the camera
  // orbits around the cube.
  // ---------------------------------------------------------------------------
  private static readonly RIM_TARGET = new THREE.Vector3(1, 1, 1);
  private updateRimLight() {
    const target = Renderer.RIM_TARGET;
    const dir    = this.camera.position.clone().sub(target).normalize();
    this.rimLight.position.copy(target).addScaledVector(dir, -7);
    this.rimLight.position.y += 1.5;
    this.rimLight.target.position.copy(target);
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
  // Reusable scratch — distance-to-target lookup used every frame
  private static readonly TICK_TARGET = new THREE.Vector3(1, 1, 1);

  tick(now: number) {
    this.tickEdgeAnims(now);
    this.tickCubeAnims(now);
    this.updateRimLight();

    // Distance from camera to cube center — used for both dynamic fog and
    // the depth-of-field focal plane.  Recomputed every frame so the depth
    // cues track the user's pinch-zoom in real time.
    const camDist = this.camera.position.distanceTo(Renderer.TICK_TARGET);

    // Dynamic fog: always wraps the cube. The cube extends ±~1.73 from the
    // center (sphere bound), so we start the fog ~1.5 units in front of
    // center and finish it ~3.5 units behind — keeping the front of the
    // cube crisp and the back fading toward paper white at any zoom level.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = Math.max(0.5, camDist - 1.5);
    fog.far  = camDist + 3.5;

    // Bokeh focal plane sits slightly forward of the cube center so the front
    // edges read razor-sharp and the back edges get the most blur.
    (this.bokehPass.uniforms as Record<string, THREE.IUniform>).focus.value =
      Math.max(0.1, camDist - 0.6);

    this.composer.render();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);

    // Postprocessing pipeline must follow the canvas size, including the
    // bokeh shader's aspect uniform — without this the DoF blur skews
    // horizontally on portrait phones / vertically on ultrawides.
    if (this.composer) {
      this.composer.setSize(width, height);
      (this.bokehPass.uniforms as Record<string, THREE.IUniform>).aspect.value =
        width / height;
    }
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
    this.composerTarget?.dispose();
    this.renderer.dispose();
  }
}
