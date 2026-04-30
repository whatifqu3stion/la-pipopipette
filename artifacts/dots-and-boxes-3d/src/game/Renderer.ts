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

// Base opacity of the drop shadow on the implied floor.  Per-frame fade in
// tick() multiplies this down to 0 when the camera tilts below the cube,
// so the floor plane never appears as a visible rectangle.
const SHADOW_FLOOR_OPACITY = 0.16;

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
// Sketch stroke geometry
//
// Each board edge is rendered as a TubeGeometry along a CatmullRomCurve3 with
// small, deterministic perpendicular jitter at intermediate control points —
// giving every line a slightly wavy, hand-drawn feel instead of a perfect
// machine-clean cylinder.
//
// • The curve lives in the mesh's local space: length 1 along the local Y
//   axis (from y=-0.5 to y=+0.5), with x/z offsets at the inner control
//   points. Endpoints are pinned to (0, ±0.5, 0) so strokes still meet
//   cleanly at corner dots.
// • Wobble is seeded from the edge key so the same edge always draws the
//   same shape — no per-frame shimmer, stable across reloads.
// • One curve per edge, four TubeGeometries per edge (one per tier radius).
//   The four tiers share the same wavy path so swapping geometry only
//   changes thickness, never silhouette.
// ---------------------------------------------------------------------------
const SKETCH_TUBULAR = 14;    // segments along the stroke — enough to read the wobble
const SKETCH_RADIAL  = 6;     // sides around the tube — slightly faceted, ink-like
const WOBBLE_AMP     = 0.013; // perpendicular jitter at midpoints (world units)

function hashEdgeKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSketchCurve(key: string): THREE.CatmullRomCurve3 {
  const rng = mulberry32(hashEdgeKey(key));
  const N   = 6;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const y = -0.5 + t;
    if (i === 0 || i === N - 1) {
      // Pin endpoints so strokes meet cleanly at the corner dots
      pts.push(new THREE.Vector3(0, y, 0));
    } else {
      const a = (rng() * 2 - 1) * WOBBLE_AMP;
      const b = (rng() * 2 - 1) * WOBBLE_AMP;
      pts.push(new THREE.Vector3(a, y, b));
    }
  }
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
}

// Total index count of a non-closed TubeGeometry: tubular * radial * 6
const SKETCH_INDEX_COUNT = SKETCH_TUBULAR * SKETCH_RADIAL * 6;

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
interface EdgeSketchData {
  startPos:    THREE.Vector3;
  endPos:      THREE.Vector3;
  midPos:      THREE.Vector3;
  dirVec:      THREE.Vector3; // unit vector along edge (length = 1 world unit)
  curve:       THREE.CatmullRomCurve3; // sketch path in mesh-local space
  geoNeutral:  THREE.TubeGeometry;
  geoCompleted: THREE.TubeGeometry;
  geoOwned:    THREE.TubeGeometry;
  geoHover:    THREE.TubeGeometry;
}

interface EdgeAnimState {
  owner:     'A' | 'B';
  startTime: number;
  sketch:    EdgeSketchData;
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

  // Per-edge sketch geometries are owned by EdgeSketchData (one curve, four
  // tube tiers per edge, all seeded deterministically from the edge key).
  // Only the dot/highlight geometries are shared.
  private geoHighlight: THREE.SphereGeometry;
  private geoPoint:     THREE.SphereGeometry;

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

  // Invisible floor plane that receives the accent-light shadow.  Its
  // opacity is faded out per-frame in tick() when the camera tilts below
  // the cube so the plane never appears as a visible rectangle.
  private shadowFloor!: THREE.Mesh;
  private shadowFloorMat!: THREE.ShadowMaterial;

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

  // Per-edge sketch data (curve + tube geometries for all four tiers).
  // Built at initEdges time, static thereafter.
  private edgeSketches = new Map<string, EdgeSketchData>();

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
    // Scene background stays unset (null). The WebGL canvas is rendered with
    // a transparent clear color so the paper texture mounted on the page
    // body in App.tsx becomes the visible board surface. Fog still fades
    // cube fragments toward BG_COLOR (cream) — that cream then composites
    // onto the paper texture, blending naturally with its average tone.
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
      alpha:           true, // transparent clear → page paper bg shows through
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x000000, 0); // fully transparent clear
    // Soft shadow map — used only by the accent light to drop a faint
    // smudge onto the implied floor below the cube. Cube content does not
    // self-shadow (out of scope); only the floor receives.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

    // Shared geometries (corner dots + traveling spark). Edge stroke
    // geometries are per-edge and live on EdgeSketchData.
    this.geoHighlight = new THREE.SphereGeometry(RADIUS_HIGHLIGHT, 8, 8);
    this.geoPoint     = new THREE.SphereGeometry(RADIUS_POINT,     8, 8);

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

    // Accent light + shadow caster.
    // Sole purpose is twofold: (a) add a small extra dimensional cue on top
    // of the existing key/fill, and (b) cast a soft drop shadow onto the
    // implied floor below the cube.  Intensity is intentionally low so the
    // surface lighting on the cube only changes by a hair.
    const accent = new THREE.DirectionalLight(0xfff5e0, 0.12);
    accent.position.set(2.5, 14, 2.5);
    accent.target.position.set(1, 0, 1); // aim at cube footprint center
    accent.castShadow = true;
    // Tight orthographic frustum that just contains the cube footprint plus
    // a margin for the floor plane around it.  Keeping the frustum tight
    // gives the most shadow-map resolution per texel.
    const sc = accent.shadow.camera as THREE.OrthographicCamera;
    sc.left   = -5; sc.right = 5;
    sc.top    =  5; sc.bottom = -5;
    sc.near   =  4; sc.far    = 28;
    sc.updateProjectionMatrix();
    accent.shadow.mapSize.set(1024, 1024);
    accent.shadow.radius      = 6;       // PCF blur radius — soft smudge edges
    accent.shadow.bias        = -0.0005; // avoid acne on thin geometry
    accent.shadow.normalBias  = 0.02;    // avoid Peter Panning on dot/edge contacts
    this.scene.add(accent);
    this.scene.add(accent.target);

    // Shadow-catcher floor — invisible plane below the cube.  Only the
    // shadow is rendered (ShadowMaterial), so the plane itself never
    // appears as a visible surface.  Sits 1.5 units below the cube's
    // bottom face — well outside the gameplay reading area.
    this.shadowFloorMat = new THREE.ShadowMaterial({
      color:   0x3a2d1f,            // warm dark — sits naturally on warm paper bg
      opacity: SHADOW_FLOOR_OPACITY, // tick() fades from this baseline
    });
    this.shadowFloorMat.transparent = true;
    this.shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      this.shadowFloorMat,
    );
    this.shadowFloor.rotation.x = -Math.PI / 2;
    this.shadowFloor.position.set(1, -1.5, 1);
    this.shadowFloor.receiveShadow = true;
    // Render before the transparent face/cube fills (renderOrder 1/2) so the
    // sort order is unambiguous when the camera is roughly horizontal.
    this.shadowFloor.renderOrder = -1;
    this.scene.add(this.shadowFloor);
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
      // Cast onto the implied floor — receiveShadow stays off so dots never
      // self-shadow against each other or against neighboring edges.
      mesh.castShadow = true;
      this.scene.add(mesh);
    }
  }

  initEdges(edges: EdgeState[]) {
    for (const { edge } of edges) {
      const key = edgeKey(edge);
      const { mesh, hitMesh, sketch } = this.createEdgeMesh(edge, key);
      mesh.userData    = { edgeKey: key };
      hitMesh.userData = { edgeKey: key };
      this.edgeMeshes.set(key, mesh);
      this.edgeHitMeshes.set(key, hitMesh);
      this.edgeSketches.set(key, sketch);
      this.scene.add(mesh);
      this.scene.add(hitMesh);
    }
  }

  private createEdgeMesh(
    edge: import('./types').Edge,
    key:  string,
  ): {
    mesh:    THREE.Mesh;
    hitMesh: THREE.Mesh;
    sketch:  EdgeSketchData;
  } {
    const { start, direction } = edge;

    const startPos = new THREE.Vector3(start.x, start.y, start.z);
    const dirVec   = new THREE.Vector3(
      direction === 'x' ? 1 : 0,
      direction === 'y' ? 1 : 0,
      direction === 'z' ? 1 : 0,
    );
    const midPos = startPos.clone().addScaledVector(dirVec, 0.5);
    const endPos = startPos.clone().addScaledVector(dirVec, 1);

    // Build the per-edge sketch curve and four tier geometries.
    // The curve lives in mesh-local space (Y from -0.5 to +0.5).
    const curve = makeSketchCurve(key);
    const sketch: EdgeSketchData = {
      startPos, endPos, midPos, dirVec, curve,
      geoNeutral:   new THREE.TubeGeometry(curve, SKETCH_TUBULAR, RADIUS_NEUTRAL,   SKETCH_RADIAL, false),
      geoCompleted: new THREE.TubeGeometry(curve, SKETCH_TUBULAR, RADIUS_COMPLETED, SKETCH_RADIAL, false),
      geoOwned:     new THREE.TubeGeometry(curve, SKETCH_TUBULAR, RADIUS_OWNED,     SKETCH_RADIAL, false),
      geoHover:     new THREE.TubeGeometry(curve, SKETCH_TUBULAR, RADIUS_HOVER,     SKETCH_RADIAL, false),
    };

    const mesh = new THREE.Mesh(sketch.geoNeutral, this.matNeutral);
    mesh.position.copy(midPos);
    // Orient the mesh so local +Y aligns with +dirVec for ALL three axes.
    // This guarantees the curve's local-Y start (-0.5) maps to the edge's
    // worldspace startPos, so the draw-in animation always grows from
    // start → end consistently across x/y/z edges.
    if (direction === 'x')      mesh.rotation.z = -Math.PI / 2;
    else if (direction === 'z') mesh.rotation.x =  Math.PI / 2;
    mesh.updateMatrixWorld();
    // Cast onto the implied floor — no self-shadowing on the cube itself.
    mesh.castShadow = true;

    // Hit cylinder: kept generous and unchanged for raycasting precision.
    const hitGeo  = new THREE.CylinderGeometry(0.18, 0.18, 1, 6);
    const hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
    hitMesh.position.copy(midPos);
    if (direction === 'x')      hitMesh.rotation.z = Math.PI / 2;
    else if (direction === 'z') hitMesh.rotation.x = Math.PI / 2;

    return { mesh, hitMesh, sketch };
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
      const key    = edgeKey(edge);
      const mesh   = this.edgeMeshes.get(key);
      const sketch = this.edgeSketches.get(key);
      if (!mesh || !sketch) continue;

      // Skip edges currently in a draw-in animation — tick() owns them
      if (this.edgeAnims.has(key)) continue;

      if (key === this.hoveredEdgeKey && !owner) {
        // ① Hover — interactive signal
        mesh.geometry = sketch.geoHover;
        mesh.material = this.matHover;

      } else if (key === this.lastPlacedEdgeKey && owner) {
        // ② Post-placement glow (timer running)
        mesh.geometry = sketch.geoOwned;
        mesh.material = owner === 'A' ? this.matGlowA : this.matGlowB;

      } else if (completedCubeEdgeOwner.has(key)) {
        // ③ Cage wire of a completed cube — lighter, calmer
        const cubeOwner = completedCubeEdgeOwner.get(key)!;
        mesh.geometry = sketch.geoCompleted;
        mesh.material = cubeOwner === 'A' ? this.matCompA : this.matCompB;

      } else if (owner === 'A') {
        // ④ Owned mid-game — full player mark
        mesh.geometry = sketch.geoOwned;
        mesh.material = this.matPlayerA;

      } else if (owner === 'B') {
        mesh.geometry = sketch.geoOwned;
        mesh.material = this.matPlayerB;

      } else {
        // ⑤ Neutral / unplayed — ghost structure
        mesh.geometry = sketch.geoNeutral;
        mesh.material = this.matNeutral;
      }

      // Ensure full stroke is drawn (drawRange may have been clamped during
      // a prior in-flight draw-in animation on this geometry).
      mesh.geometry.drawRange.start = 0;
      mesh.geometry.drawRange.count = Infinity;
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
   *
   * Sketch implementation: the mesh stays put at midPos; we swap to the
   * owned tube and reveal it progressively along its curve via drawRange.
   * The traveling spark rides the actual wavy curve in world space, so it
   * truly hugs the leading tip instead of a straight reference line.
   */
  beginEdgePlaceAnim(key: string, owner: 'A' | 'B') {
    const mesh   = this.edgeMeshes.get(key);
    const sketch = this.edgeSketches.get(key);
    if (!mesh || !sketch) return;

    // Cancel any previous animation on this key
    const prev = this.edgeAnims.get(key);
    if (prev) {
      this.scene.remove(prev.highlight);
      // Restore drawRange on whatever geometry the previous anim was using
      prev.sketch.geoOwned.drawRange.count = Infinity;
      this.edgeAnims.delete(key);
    }

    // Apply draw material immediately and clamp drawRange to the very start
    mesh.geometry = sketch.geoOwned;
    mesh.material = owner === 'A' ? this.matGlowA : this.matGlowB;
    sketch.geoOwned.drawRange.start = 0;
    sketch.geoOwned.drawRange.count = 0;

    // Traveling highlight spark — starts at the curve's begin point
    const highlight = new THREE.Mesh(
      this.geoHighlight,
      owner === 'A' ? this.matHighlightA : this.matHighlightB,
    );
    highlight.position.copy(sketch.startPos);
    this.scene.add(highlight);

    this.edgeAnims.set(key, {
      owner, startTime: performance.now(), sketch, highlight,
    });
  }

  /** Call on undo or reset — cancels active animations and clears glow state. */
  clearLastPlaced() {
    // Cancel all in-flight edge animations and restore their owned-tier
    // drawRange so any future render of that geometry shows the full stroke.
    for (const [, anim] of this.edgeAnims) {
      this.scene.remove(anim.highlight);
      anim.sketch.geoOwned.drawRange.start = 0;
      anim.sketch.geoOwned.drawRange.count = Infinity;
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
  // Reusable scratch — avoids per-frame allocations when computing the
  // spark's world position from the edge's local sketch curve.
  private static readonly TICK_LOCAL_PT = new THREE.Vector3();

  private tickEdgeAnims(now: number) {
    for (const [key, anim] of this.edgeAnims) {
      const mesh = this.edgeMeshes.get(key);
      if (!mesh) { this.edgeAnims.delete(key); continue; }

      const raw = Math.min((now - anim.startTime) / EDGE_ANIM_MS, 1);
      const p   = easeOutCubic(raw);

      // Reveal the leading portion of the tube along its curve. drawRange
      // operates on indices, and TubeGeometry emits SKETCH_RADIAL * 6 indices
      // per tubular ring — so revealing N rings means N * SKETCH_RADIAL * 6
      // indices, walking the stroke smoothly from start to end.
      const ringsRevealed = Math.max(0, Math.floor(SKETCH_TUBULAR * p));
      anim.sketch.geoOwned.drawRange.count = ringsRevealed * SKETCH_RADIAL * 6;

      // Highlight spark rides the actual wavy curve (not a straight line).
      // The curve is in mesh-local space, so transform it into world space
      // via mesh.matrixWorld (kept fresh below).
      mesh.updateMatrixWorld();
      const localPt = anim.sketch.curve.getPoint(p, Renderer.TICK_LOCAL_PT);
      anim.highlight.position.copy(localPt).applyMatrix4(mesh.matrixWorld);

      if (raw >= 1) {
        // Animation complete — restore full draw range
        anim.sketch.geoOwned.drawRange.count = Infinity;

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

    // Fade the shadow-catcher floor out gracefully as the camera tilts
    // toward / below the floor's level so it never appears as a visible
    // smudge from low angles. Fade window is anchored to the floor's y
    // (-1.5): full opacity when the camera sits at or above cube center
    // (y >= 1.5), zero by the time the camera reaches the floor level.
    const camY  = this.camera.position.y;
    const fade  = Math.max(0, Math.min(1, (camY + 1.5) / 3.0));
    this.shadowFloorMat.opacity = SHADOW_FLOOR_OPACITY * fade;

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
    // Per-edge sketch geometries (4 tubes per edge)
    for (const sketch of this.edgeSketches.values()) {
      sketch.geoNeutral.dispose();
      sketch.geoCompleted.dispose();
      sketch.geoOwned.dispose();
      sketch.geoHover.dispose();
    }
    this.edgeSketches.clear();
    this.geoHighlight.dispose();
    this.geoPoint.dispose();
    this.shadowFloor.geometry.dispose();
    this.shadowFloorMat.dispose();
    this.composerTarget?.dispose();
    this.renderer.dispose();
  }
}
