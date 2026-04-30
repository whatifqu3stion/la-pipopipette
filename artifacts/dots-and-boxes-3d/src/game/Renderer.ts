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
  A: 0x1a8cff, // vibrant electric blue
  B: 0xff3b40, // vibrant fire-engine red
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
  A: 0x76baff,
  B: 0xff8a8c,
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
const EDGE_ANIM_MS = 1000; // edge draw-in duration (ms) — paced like a hand stroke
const EDGE_GLOW_MS = 350;  // post-draw emphasis duration (ms)
const CUBE_ANIM_MS = 400;  // cube scale-in duration (ms)
const FACE_FILL_MS = 800;  // face "marker stroke" fill-in duration (ms)

// Glow swell that masks the wavy → straight geometry snap.
// During the last (1 - GLOW_SWELL_START_FRAC) of the draw, the stroke's
// emissive intensity ramps from BASE up to PEAK so it's visibly aglow at
// the moment the geometry snaps to the clean line — the brighter pulse
// distracts the eye from the geometric change. After the snap the glow
// decays smoothly back to 0 across EDGE_GLOW_MS, then the stroke settles
// to its non-emissive resting material.
const GLOW_INTENSITY_BASE   = 0.22; // matches matGlow's resting intensity
const GLOW_INTENSITY_PEAK   = 0.55; // peak right at the snap
const GLOW_SWELL_START_FRAC = 0.55; // begin ramping at 55% through the draw

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

// S-curve: gentle acceleration at the start, brief sustained middle,
// soft deceleration at the end. Matches the speed profile of a hand
// drawing a deliberate ink stroke — better "human pen" feel than a
// pure ease-out (which whips at the start then crawls to a halt).
function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
// • After construction, every owned/completed/settled tube is post-processed
//   by applyEdgeTaper() which (a) pinches the ends toward zero radius for a
//   tapered "pen tip" look and (b) bakes a subtle per-ring brightness
//   variation into a vertex-color attribute for ink-pooling realism.
// ---------------------------------------------------------------------------
const SKETCH_TUBULAR  = 20;    // segments along the stroke — finer for smooth taper
const SKETCH_RADIAL   = 6;     // sides around the tube — slightly faceted, ink-like
// Two-frequency wobble: a slow drift (hand sway) + small jitter (paper grain).
// Sum of the two stays close to the previous single-frequency feel (~0.013)
// but the curve shape now has both low- and high-frequency components.
const WOBBLE_AMP_LOW  = 0.011; // slow drift across the stroke (world units)
const WOBBLE_AMP_HIGH = 0.005; // fine jitter at each control point (world units)

// Tapered radius along the stroke: r(t) = TAPER_MIN + (1 - TAPER_MIN) * sin(πt)^TAPER_EXP
//   t = 0   → r = TAPER_MIN   (pen touchdown)
//   t = 0.5 → r = 1.0         (full pressure)
//   t = 1   → r = TAPER_MIN   (pen lift)
// TAPER_EXP < 1 widens the "fat middle" plateau (more pen-like) while still
// pinching cleanly at the ends. TAPER_MIN keeps the tip from collapsing to a
// degenerate point that would alias badly under MSAA / Bokeh blur.
const TAPER_MIN = 0.20;
const TAPER_EXP = 0.55;

// Per-ring brightness modulation amplitude — ±RING_COLOR_AMP around 1.0.
// Multiplied against material color via vertexColors. Low value (~0.07) reads
// as ink "flow" variation rather than chromatic noise.
const RING_COLOR_AMP = 0.07;

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

// ---------------------------------------------------------------------------
// Ink dot geometry — hand-placed corner anchors
//
// Corner dots used to be a single shared SphereGeometry — perfectly round,
// identical, machine-clean.  Against the wavy hand-drawn edges they read as
// CG.  These helpers produce a per-dot deterministic geometry with subtle
// vertex wobble and per-axis squish, plus a slight tilt — so each dot looks
// hand-placed but is stable across frames and reloads (seeded by the dot's
// integer grid position).
// ---------------------------------------------------------------------------
const INK_DOT_WOBBLE = 0.10; // ±10% radial vertex displacement
const INK_DOT_SQUISH = 0.18; // ±9% per-axis scale variation
const INK_DOT_TILT   = 0.40; // ±0.4 rad tilt on each axis

function hashPoint(p: { x: number; y: number; z: number }): number {
  return hashEdgeKey(`P:${p.x},${p.y},${p.z}`);
}

interface InkDotShape {
  geo:   THREE.SphereGeometry;
  scale: THREE.Vector3;
  rot:   THREE.Euler;
}

function makeInkDot(seed: number, baseRadius: number): InkDotShape {
  const rng = mulberry32(seed);
  const geo = new THREE.SphereGeometry(baseRadius, 12, 10);
  const pos = geo.attributes.position;
  // Per-vertex radial wobble — irregular ink-dot silhouette
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    const w   = 1 + (rng() * 2 - 1) * INK_DOT_WOBBLE;
    pos.setXYZ(
      i,
      (x / len) * baseRadius * w,
      (y / len) * baseRadius * w,
      (z / len) * baseRadius * w,
    );
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  // Per-axis squish — each dot a slightly different shape, never larger
  // than the baseline radius (hit feel and visual weight stay consistent)
  const half = INK_DOT_SQUISH * 0.5;
  const sx = 1 - half + rng() * INK_DOT_SQUISH;
  const sy = 1 - half + rng() * INK_DOT_SQUISH;
  const sz = 1 - half + rng() * INK_DOT_SQUISH;
  // Subtle tilt — tiny rotation so wobble pattern doesn't all align
  const rx = (rng() * 2 - 1) * INK_DOT_TILT;
  const ry = (rng() * 2 - 1) * INK_DOT_TILT;
  const rz = (rng() * 2 - 1) * INK_DOT_TILT;
  return {
    geo,
    scale: new THREE.Vector3(sx, sy, sz),
    rot:   new THREE.Euler(rx, ry, rz),
  };
}

function makeSketchCurve(key: string): THREE.CatmullRomCurve3 {
  const rng = mulberry32(hashEdgeKey(key));
  // Two random phases for the slow drift — one per perpendicular axis.
  // Pulled out of the loop so the drift is coherent (a single bow across
  // the whole stroke) rather than re-randomized at each control point.
  const lowPhaseA = rng() * Math.PI * 2;
  const lowPhaseB = rng() * Math.PI * 2;
  // 12 control points — finer than the previous 6 so the high-frequency
  // jitter has somewhere to live in the catmull-rom interpolation.
  const N = 12;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const y = -0.5 + t;
    if (i === 0 || i === N - 1) {
      // Pin endpoints so strokes meet cleanly at the corner dots
      pts.push(new THREE.Vector3(0, y, 0));
    } else {
      // Low-frequency hand drift: ~1.5 half-cycles across the stroke
      const lowA  = Math.sin(t * Math.PI * 1.5 + lowPhaseA) * WOBBLE_AMP_LOW;
      const lowB  = Math.sin(t * Math.PI * 1.5 + lowPhaseB) * WOBBLE_AMP_LOW;
      // High-frequency paper-grain jitter — random per control point
      const highA = (rng() * 2 - 1) * WOBBLE_AMP_HIGH;
      const highB = (rng() * 2 - 1) * WOBBLE_AMP_HIGH;
      pts.push(new THREE.Vector3(lowA + highA, y, lowB + highB));
    }
  }
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
}

// ---------------------------------------------------------------------------
// applyEdgeTaper — post-process a tube/cylinder geometry in place to
// (a) pinch its ends toward TAPER_MIN of the original radius (pen-tip taper
//     with a fat pressure-swelled middle), and
// (b) bake a subtle per-ring brightness multiplier into a vertex-color
//     attribute, simulating uneven ink flow.
//
// Works on any geometry whose vertex layout is `numRings` rings each with
// `vertsPerRing` vertices, contiguous, in row-major order — which is exactly
// what TubeGeometry and (open-ended) CylinderGeometry produce. The centerline
// for each ring is computed by averaging the ring's vertices, so we don't
// need to know anything about the underlying curve.
// ---------------------------------------------------------------------------
function applyEdgeTaper(
  geo:          THREE.BufferGeometry,
  numRings:     number,
  vertsPerRing: number,
  rng:          () => number,
) {
  const positions = geo.attributes.position;
  const colors    = new Float32Array(positions.count * 3);
  // Default any vertices outside the (numRings × vertsPerRing) block to white
  // so they don't get accidentally darkened (e.g. cap vertices, if any).
  colors.fill(1);

  // TubeGeometry / open-ended CylinderGeometry duplicate the seam vertex —
  // index 0 and index (vertsPerRing - 1) sit at the same angular position
  // (UV continuity). Including both in the centroid average biases the center
  // toward the seam and produces lopsided tapering, especially near the
  // pinched tips. Average only the unique radial samples [0 .. vertsPerRing-2]
  // for the centerline; we still scale ALL vertices (seam included) below so
  // the seam stays continuous.
  const uniqueRadial = vertsPerRing - 1;

  for (let ri = 0; ri < numRings; ri++) {
    // Ring centerline = mean of unique radial samples (skip seam duplicate)
    let cx = 0, cy = 0, cz = 0;
    for (let vi = 0; vi < uniqueRadial; vi++) {
      const idx = ri * vertsPerRing + vi;
      cx += positions.getX(idx);
      cy += positions.getY(idx);
      cz += positions.getZ(idx);
    }
    cx /= uniqueRadial; cy /= uniqueRadial; cz /= uniqueRadial;

    const t           = numRings > 1 ? ri / (numRings - 1) : 0;
    const taperBase   = Math.sin(Math.PI * t);
    const radiusScale = TAPER_MIN + (1 - TAPER_MIN) * Math.pow(taperBase, TAPER_EXP);

    // Brightness: small low-freq sweep (ink flow gradient) + small jitter
    const lowFreq    = 0.5 * Math.sin(t * Math.PI * 2);
    const highFreq   = rng() - 0.5;
    const brightness = 1 + RING_COLOR_AMP * (lowFreq * 0.6 + highFreq * 0.4);

    for (let vi = 0; vi < vertsPerRing; vi++) {
      const idx = ri * vertsPerRing + vi;
      const dx  = positions.getX(idx) - cx;
      const dy  = positions.getY(idx) - cy;
      const dz  = positions.getZ(idx) - cz;
      positions.setXYZ(
        idx,
        cx + dx * radiusScale,
        cy + dy * radiusScale,
        cz + dz * radiusScale,
      );
      colors[idx * 3 + 0] = brightness;
      colors[idx * 3 + 1] = brightness;
      colors[idx * 3 + 2] = brightness;
    }
  }

  positions.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
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

// Shared GLSL: smooth value noise + 4-octave fBm.
// Used by both face and cube shaders to produce watercolor-style washes
// (organic, low-frequency density variation) instead of high-frequency
// hashed pixel grain.  Same hash21() helper as before — kept for
// compatibility with any future per-pixel uses.
const SKETCH_NOISE_GLSL = /* glsl */`
  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 17.31);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p *= 2.07;
      a *= 0.5;
    }
    return v;
  }
`;

// Face fill: a soft watercolor wash on the face's UV plane.
// • fBm produces low-frequency density patches — denser pools and lighter
//   regions, like real wet pigment unevenly settling on paper.
// • A subtle "dry edge" pool ring near the perimeter mimics how watercolor
//   migrates outward as the wash dries.
// • A soft mask near the very edge of the UV square keeps the wash from
//   reaching the corner pixels — pigment rarely fills a region perfectly.
// • uFill (0..1) animates a serpentine "marker stroke" coloring-in motion:
//   the face is split into N horizontal bands, and the fill sweeps left↔
//   right across each band in turn (alternating direction) as uFill rises
//   from 0 to 1. uFill = 1 ⇒ entire face revealed. The fill mask is
//   multiplied into the alpha so unpainted pixels are fully transparent.
const FACE_FRAG = /* glsl */`
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform float uFill;
  uniform vec2  uSeed;
  varying vec2  vUv;

  ${SKETCH_NOISE_GLSL}

  void main() {
    if (uOpacity <= 0.001) discard;
    vec2  q       = vUv * 3.5 + uSeed;
    float wash    = fbm(q);                         // 0..~1 organic patches
    float washMod = 0.55 + 1.10 * wash;             // density: ~0.55..1.65
    vec2  c       = abs(vUv - 0.5) * 2.0;
    float edgeD   = max(c.x, c.y);                  // 0 center → 1 perimeter
    float pool    = smoothstep(0.55, 0.92, edgeD) * 0.45;
    float mask    = 1.0 - smoothstep(0.86, 1.0, edgeD);

    // Serpentine marker-stroke reveal. Each horizontal band fills L→R or
    // R→L in alternation. Per-pixel "stroke time" is the abstract moment
    // (in band units, 0..STROKES) when the marker tip reaches this pixel.
    const float STROKES   = 5.0;
    // min() guards the vUv.y == 1.0 edge row from quantising to a phantom
    // 6th band (idx 5) that would never fill on some GPUs.
    float       bandIdx   = min(floor(vUv.y * STROKES), STROKES - 1.0);
    float       ltrFlag   = 1.0 - mod(bandIdx, 2.0);         // 1 = L→R, 0 = R→L
    float       xPos      = mix(1.0 - vUv.x, vUv.x, ltrFlag);
    float       pixelTime = bandIdx + xPos;                  // 0..STROKES
    float       reach     = uFill * STROKES;                 // 0..STROKES
    // Soft 1-band-thickness leading edge so the marker tip reads as a
    // tiny ramp rather than a hard line — keeps the watercolor look.
    float       fillMask  = 1.0 - smoothstep(reach - 0.04, reach + 0.04, pixelTime);

    float a       = uOpacity * (washMod + pool) * mask * fillMask;
    gl_FragColor  = vec4(uColor, clamp(a, 0.0, 1.0));
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

// Cube fill: per-face watercolor wash + fresnel rim for painterly depth.
// • Each BoxGeometry face has its own 0..1 UV space, so the fBm wash is
//   independent on each face — like six separate brush strokes meeting
//   at the corners of the volume.
// • The fresnel rim (kept from the previous shader) deepens the wash near
//   the true silhouette, mimicking how watercolor pools at the edge of a
//   flat shape as it dries.
// • Deliberately no UV-edge-derived terms (mask or pool).  Cube-face UV
//   borders are internal seams between adjacent faces, not visual edges;
//   any UV-edge darkening here would render as a hard dark line along
//   each cube corner where two faces meet.  Only the view-dependent rim
//   should drive perimeter density.
const CUBE_FRAG = /* glsl */`
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform vec2  uSeed;
  varying vec3  vNormal;
  varying vec3  vViewDir;
  varying vec2  vUv;

  ${SKETCH_NOISE_GLSL}

  void main() {
    if (uOpacity <= 0.001) discard;
    float ndv     = max(dot(vNormal, vViewDir), 0.0);
    float rim     = pow(1.0 - ndv, 2.2);
    vec2  q       = vUv * 3.0 + uSeed;
    float wash    = fbm(q);                         // 0..~1 per-face patches
    float washMod = 0.70 + 0.85 * wash;             // density: ~0.70..1.55
    float a       = uOpacity * washMod + rim * 0.18;
    gl_FragColor  = vec4(uColor, clamp(a, 0.0, 1.0));
  }
`;

function makeFaceMat(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader:   FACE_VERT,
    fragmentShader: FACE_FRAG,
    uniforms: {
      uColor:   { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.0 },
      uFill:    { value: 1.0 }, // 0..1 — driven by tickFaceAnims when a face completes
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
// Edge-tier geometry policy:
// • NEUTRAL (unplayed grid) and HOVER (interactive preview) use a single
//   shared straight CylinderGeometry — the grid reads as a clean,
//   structured guide. Hover stays clean too: it's the "this slot exists"
//   preview, not yet an inked stroke.
// • OWNED and COMPLETED use per-edge wavy TubeGeometry (built in
//   createEdgeMesh) — once a player commits a stroke, it becomes a
//   hand-drawn ink line.
interface EdgeSketchData {
  startPos:    THREE.Vector3;
  endPos:      THREE.Vector3;
  midPos:      THREE.Vector3;
  dirVec:      THREE.Vector3; // unit vector along edge (length = 1 world unit)
  curve:       THREE.CatmullRomCurve3; // sketch path in mesh-local space
  // Per-edge wavy ink strokes (only used by OWNED/COMPLETED tiers)
  geoCompleted: THREE.TubeGeometry;
  geoOwned:    THREE.TubeGeometry;
}

interface EdgeAnimState {
  owner:     'A' | 'B';
  startTime: number;
  sketch:    EdgeSketchData;
  // Per-anim clone of matGlowA/B so we can mutate emissiveIntensity
  // without affecting other in-flight glowing edges.
  mat:       THREE.MeshStandardMaterial;
  // Set when raw draw progress hits 1 (geometry has snapped to straight).
  // From this point we are in the post-snap glow-decay phase.
  snapTime:  number | null;
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
  // Per-dot ink geometries (deterministic, irregular).  Tracked so dispose()
  // can free GPU buffers — there is no shared geoPoint anymore.
  private dotGeometries: THREE.SphereGeometry[] = [];
  // Shared straight-cylinder geometries for the unplayed grid (NEUTRAL),
  // the interactive preview (HOVER), and the settled played stroke (OWNED).
  // Single instance per tier, reused by every edge mesh — orientation is
  // handled by per-edge mesh rotation. The OWNED variant is what each
  // played edge swaps to once its wavy draw-in animation completes, so
  // the line "settles" from organic ink into a clean grid mark.
  private geoStraightNeutral: THREE.CylinderGeometry;
  private geoStraightHover:   THREE.CylinderGeometry;
  private geoStraightOwned:   THREE.CylinderGeometry;

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

  // ── Turntable rotation ────────────────────────────────────────────────
  // All cube content (dots, edges, hit meshes, faces, cubes, in-flight
  // pen-stroke sparks) lives inside cubeContent, which is parented to
  // cubePivot. Rotating cubePivot.rotation.y spins the cube around its
  // own vertical center axis while the camera, lights, fog, and shadow
  // floor stay anchored in world space — giving a turntable feel where
  // the ground and shadow stay put while only the cube turns.
  //
  // Two-group layout so existing child positions (which are in world
  // coords like (1,1,1) for the cube center) don't have to be rewritten
  // to be pivot-local:
  //   • cubePivot is positioned at the cube center (1,1,1). This is
  //     where rotation happens, so spinning is around the cube's center.
  //   • cubeContent is offset by (-1,-1,-1) inside cubePivot, cancelling
  //     the pivot's translation. A child added with its original world
  //     position (e.g. an edge whose midpoint sits at (0,0,0)) ends up
  //     exactly where it was before through the two transforms.
  private cubePivot!: THREE.Group;
  private cubeContent!: THREE.Group;

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

  // Per-edge sketch data (curve + tube geometries for all four tiers).
  // Built at initEdges time, static thereafter.
  private edgeSketches = new Map<string, EdgeSketchData>();

  // Edge draw-in animations — keyed by edgeKey
  private edgeAnims = new Map<string, EdgeAnimState>();

  // Cube scale-in animations — keyed by cubeKey
  private cubeAnimTimes = new Map<string, number>(); // cubeKey → startTime
  private cubeComplete  = new Set<string>();          // tracks which cubes have begun anim

  // Face fill-in animations — keyed by faceKey. faceComplete tracks which
  // faces are currently in the "completed" state so we only kick off the
  // marker-stroke animation on the *transition* from incomplete → complete
  // (not every frame the face is already complete).
  private faceAnimTimes = new Map<string, number>(); // faceKey → startTime
  private faceComplete  = new Set<string>();

  private raycaster     = new THREE.Raycaster();
  private validEdgeKeys = new Set<string>();

  // ---------------------------------------------------------------------------
  constructor(canvas: HTMLCanvasElement) {
    this.scene      = new THREE.Scene();
    // Scene background is an opaque cream — the canvas itself reads as the
    // paper surface. We can't rely on a transparent clear because the
    // postprocessing pipeline (BokehPass) ALWAYS writes alpha = 1.0 in its
    // fragment shader, which would force every empty pixel to opaque black
    // and hide the page CSS underneath. Setting scene.background to BG_COLOR
    // matches the page CSS bg exactly, and the SVG paper-grain overlay in
    // App.tsx (mixBlendMode: multiply) supplies the fiber texture on top.
    // Fog still fades cube fragments toward BG_COLOR for the depth fade.
    // Linear fog — initial range is a sensible default for the fallback
    // camera distance (~7 units). The actual near/far values are recomputed
    // every frame in tick() relative to the current camera distance, so the
    // fade always wraps the cube no matter how far the user has zoomed in.
    this.scene.fog        = new THREE.Fog(BG_COLOR, 5, 9);
    this.scene.background = new THREE.Color(BG_COLOR);

    // Turntable groups — see field declaration above for the two-group
    // rationale. Created before initPoints/initEdges/initFaces/initCubes
    // (which add their meshes into cubeContent rather than scene).
    this.cubePivot = new THREE.Group();
    this.cubePivot.position.set(1, 1, 1);
    this.scene.add(this.cubePivot);

    this.cubeContent = new THREE.Group();
    this.cubeContent.position.set(-1, -1, -1);
    this.cubePivot.add(this.cubeContent);

    const w = canvas.clientWidth  || canvas.width  || 800;
    const h = canvas.clientHeight || canvas.height || 600;
    this.camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 100);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias:       true,
      alpha:           true, // harmless; final composition is opaque (scene.background = cream)
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    // Clear color is irrelevant since scene.background is set to an opaque
    // cream — but kept defensively in case background is ever cleared.
    this.renderer.setClearColor(BG_COLOR, 1);
    // No shadow-mapping pass — the floor "shadow" is a custom radial blob
    // (see setupLighting) that's rotationally symmetric in world space so it
    // never appears to spin as the camera orbits the cube. Also saves the
    // shadow render pass per frame.
    this.renderer.shadowMap.enabled = false;

    // Shared geometries:
    // • The traveling draw-in spark (sphere) is shared.
    // • Straight cylinders for the NEUTRAL grid and HOVER preview tiers —
    //   identical for every edge (all length 1 along local-Y), so a single
    //   instance per radius tier is reused across all 54 edges. The mesh's
    //   per-edge rotation/position handles orientation.
    // • OWNED and COMPLETED tiers stay per-edge wavy TubeGeometry on
    //   EdgeSketchData so each played stroke has its own hand-drawn shape.
    // • Corner dots remain per-instance ink geometries (initPoints).
    this.geoHighlight = new THREE.SphereGeometry(RADIUS_HIGHLIGHT, 8, 8);
    this.geoStraightNeutral = new THREE.CylinderGeometry(
      RADIUS_NEUTRAL, RADIUS_NEUTRAL, 1, 8, 1, true,
    );
    this.geoStraightHover = new THREE.CylinderGeometry(
      RADIUS_HOVER, RADIUS_HOVER, 1, 8, 1, true,
    );
    // Owned settled stroke: 12 height segments so applyEdgeTaper has rings
    // to pinch toward the ends. Shared across every settled owned edge —
    // the taper pattern repeats but the modulation is subtle enough that the
    // repetition reads as a deliberate pen aesthetic, not a tiling artifact.
    this.geoStraightOwned = new THREE.CylinderGeometry(
      RADIUS_OWNED, RADIUS_OWNED, 1, 8, 12, true,
    );
    // Use a fixed seed (not per-edge) since this geometry is shared. Brightness
    // pattern will be identical across edges; that's acceptable at 7% amplitude.
    applyEdgeTaper(
      this.geoStraightOwned,
      13, // heightSegments + 1
      9,  // radialSegments + 1
      mulberry32(0xa11ce),
    );

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
    // vertexColors enabled on all owned/completed/glow materials — these are
    // the materials paired with tapered tube/cylinder geometries that bake
    // per-ring brightness into a color attribute. Multiplies material.color
    // by the per-vertex value, giving subtle ink-flow modulation along the
    // length of each stroke. matNeutral / matHover stay off (they pair with
    // un-tapered, uniform-color geometries — geoStraightNeutral / geoStraightHover).
    this.matPlayerA = new THREE.MeshStandardMaterial({
      color: PLAYER_COLORS.A, roughness: 0.60, metalness: 0.05, vertexColors: true,
    });
    this.matPlayerB = new THREE.MeshStandardMaterial({
      color: PLAYER_COLORS.B, roughness: 0.60, metalness: 0.05, vertexColors: true,
    });
    this.matCompA = new THREE.MeshStandardMaterial({
      color: COMPLETED_COLOR.A, roughness: 0.82, metalness: 0, vertexColors: true,
    });
    this.matCompB = new THREE.MeshStandardMaterial({
      color: COMPLETED_COLOR.B, roughness: 0.82, metalness: 0, vertexColors: true,
    });
    // Post-placement glow: same hue, lower roughness, slight emissive warmth
    this.matGlowA = new THREE.MeshStandardMaterial({
      color:             PLAYER_COLORS.A,
      roughness:         0.40,
      metalness:         0.05,
      emissive:          new THREE.Color(PLAYER_COLORS.A),
      emissiveIntensity: 0.22,
      vertexColors:      true,
    });
    this.matGlowB = new THREE.MeshStandardMaterial({
      color:             PLAYER_COLORS.B,
      roughness:         0.40,
      metalness:         0.05,
      emissive:          new THREE.Color(PLAYER_COLORS.B),
      emissiveIntensity: 0.22,
      vertexColors:      true,
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
    //   • aperture = 0.0055 — the cube spans ~3 world units front-to-back,
    //     which now produces a visibly soft back face even at close zoom
    //     instead of the previous near-imperceptible 3-4px smear.
    //   • maxblur  = 0.006  — half the previous cap; this is what limits
    //     the halo bleed where the cube silhouette meets the paper, so
    //     the effect reads as depth-of-field rather than a drop shadow.
    this.bokehPass = new BokehPass(this.scene, this.camera, {
      focus:    7,        // overwritten per-frame
      aperture: 0.0055,
      maxblur:  0.006,
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
    // Intensity tuned bright enough to actually paint a visible cool edge
    // along back-facing surfaces (giving the cube real depth against the
    // warmer key light) without competing with the player hues up front.
    this.rimLight = new THREE.DirectionalLight(0xdde9ff, 0.50);
    this.rimLight.position.set(-5, 3, -5);
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target); // required so position changes take effect

    // Accent light — adds a small extra dimensional cue on top of the
    // existing key/fill. No shadow casting (the floor blob below is a
    // separate world-space radial decal, not a projected silhouette).
    const accent = new THREE.DirectionalLight(0xfff5e0, 0.12);
    accent.position.set(2.5, 14, 2.5);
    accent.target.position.set(1, 0, 1); // aim at cube footprint center
    this.scene.add(accent);
    this.scene.add(accent.target);

    // Floor "shadow" — a soft radial blob anchored under the cube center
    // in world space. Rendered with a custom shader instead of the previous
    // ShadowMaterial + cast-shadow setup. The previous approach projected
    // the cube's silhouette (a square) straight down, so as the camera
    // orbited, the shadow's square edges visibly rotated. A radial blob is
    // rotationally symmetric, so the same view angle in any direction gives
    // an identical shadow read — the shadow stays put under the cube and
    // only "reacts" if the cube itself moves or scales.
    //
    // Falloff is computed in world XZ from the cube footprint center (1,1):
    //   • full strength inside `uPlateau` (covers the structure footprint)
    //   • smooth fade out to `uFalloff`
    //   • discarded beyond, so no transparent fill cost on far pixels.
    this.shadowFloorMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor:    { value: new THREE.Color(0x3a2d1f) }, // warm dark, matches old
        uOpacity:  { value: SHADOW_FLOOR_OPACITY },      // tick() fades this
        uCenter:   { value: new THREE.Vector2(1, 1) },   // structure XZ center
        uPlateau:  { value: 1.24 },                      // full-strength radius
        uFalloff:  { value: 2.64 },                      // outer fade radius
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp   = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3  uColor;
        uniform float uOpacity;
        uniform vec2  uCenter;
        uniform float uPlateau;
        uniform float uFalloff;
        varying vec3  vWorldPos;
        void main() {
          float dist = length(vec2(vWorldPos.x, vWorldPos.z) - uCenter);
          float blob = 1.0 - smoothstep(uPlateau, uFalloff, dist);
          // Slight power curve softens the inner edge of the falloff
          blob = pow(blob, 1.4);
          if (blob < 0.001) discard;
          gl_FragColor = vec4(uColor, blob * uOpacity);
        }
      `,
      transparent: true,
      depthWrite:  false,
    }) as unknown as THREE.ShadowMaterial; // typed as ShadowMaterial for field compat
    this.shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      this.shadowFloorMat,
    );
    this.shadowFloor.rotation.x = -Math.PI / 2;
    this.shadowFloor.position.set(1, -1.5, 1);
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
      // Per-dot ink shape — wobble + squish + tilt seeded from the dot's
      // grid position, so every corner reads as hand-placed but the same
      // dot always looks the same across reloads.  Geometry is owned per-
      // mesh; tracked in dotGeometries for disposal.
      const ink = makeInkDot(hashPoint(p), RADIUS_POINT);
      const mesh = new THREE.Mesh(ink.geo, this.matPoint);
      mesh.position.set(p.x, p.y, p.z);
      mesh.scale.copy(ink.scale);
      mesh.rotation.copy(ink.rot);
      // Cast onto the implied floor — receiveShadow stays off so dots never
      // self-shadow against each other or against neighboring edges.
      mesh.castShadow = true;
      // Cube content lives inside the rotating cubeContent group so it
      // spins with the turntable while lights/shadow stay in world space.
      this.cubeContent.add(mesh);
      this.dotGeometries.push(ink.geo);
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
      // Add to the rotating cubeContent group, not the scene root, so the
      // edges turn with the rest of the cube during turntable rotation.
      this.cubeContent.add(mesh);
      this.cubeContent.add(hitMesh);
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

    // Per-edge wavy sketch curve — used by the OWNED/COMPLETED tiers and
    // by the spark animation that rides the stroke during draw-in. The
    // curve lives in mesh-local space (Y from -0.5 to +0.5) so the
    // existing per-edge mesh.rotation orients it correctly across x/y/z.
    const curve = makeSketchCurve(key);
    const geoCompleted = new THREE.TubeGeometry(curve, SKETCH_TUBULAR, RADIUS_COMPLETED, SKETCH_RADIAL, false);
    const geoOwned     = new THREE.TubeGeometry(curve, SKETCH_TUBULAR, RADIUS_OWNED,     SKETCH_RADIAL, false);
    // Per-edge taper + vertex-color bake. Two independent rngs (seeded from
    // the same edge key with different salts) so completed and owned tubes
    // get visually distinct ink-flow patterns.
    const tubularRings  = SKETCH_TUBULAR + 1;
    const tubularVperR  = SKETCH_RADIAL + 1;
    applyEdgeTaper(geoCompleted, tubularRings, tubularVperR, mulberry32(hashEdgeKey(key) ^ 0xc0ffee));
    applyEdgeTaper(geoOwned,     tubularRings, tubularVperR, mulberry32(hashEdgeKey(key) ^ 0xfacade));
    const sketch: EdgeSketchData = {
      startPos, endPos, midPos, dirVec, curve,
      geoCompleted, geoOwned,
    };

    // Initial geometry is the shared straight neutral cylinder — every
    // unplayed edge reads as a clean grid line. updateEdgeStates swaps in
    // the per-edge wavy tube only when the edge becomes OWNED/COMPLETED,
    // and swaps in the shared straight hover cylinder on hover preview.
    const mesh = new THREE.Mesh(this.geoStraightNeutral, this.matNeutral);
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
      // Faces rotate with the cube on the turntable group.
      this.cubeContent.add(mesh);
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
      // Cube fills rotate with the turntable group.
      this.cubeContent.add(mesh);
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
        // ① Hover — interactive signal (clean preview, not yet inked)
        mesh.geometry = this.geoStraightHover;
        mesh.material = this.matHover;

      } else if (key === this.lastPlacedEdgeKey && owner) {
        // ② Post-placement glow (timer running) — straight settled stroke
        // in glow color. The wavy draw-in already played out in tick(); by
        // the time we're here the stroke has snapped to the clean line.
        mesh.geometry = this.geoStraightOwned;
        mesh.material = owner === 'A' ? this.matGlowA : this.matGlowB;

      } else if (completedCubeEdgeOwner.has(key)) {
        // ③ Cage wire of a completed cube — wavy ink stroke, lighter hue
        const cubeOwner = completedCubeEdgeOwner.get(key)!;
        mesh.geometry = sketch.geoCompleted;
        mesh.material = cubeOwner === 'A' ? this.matCompA : this.matCompB;

      } else if (owner === 'A') {
        // ④ Owned mid-game — settled straight stroke in player color
        mesh.geometry = this.geoStraightOwned;
        mesh.material = this.matPlayerA;

      } else if (owner === 'B') {
        mesh.geometry = this.geoStraightOwned;
        mesh.material = this.matPlayerB;

      } else {
        // ⑤ Neutral / unplayed — clean straight grid line
        mesh.geometry = this.geoStraightNeutral;
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
      const key  = faceKey(face);
      const mesh = this.faceMeshes.get(key);
      if (!mesh) continue;
      const mat = mesh.material as THREE.ShaderMaterial;
      if (complete) {
        (mat.uniforms.uColor.value as THREE.Color).setHex(
          owner === 'A' ? PLAYER_COLORS.A : owner === 'B' ? PLAYER_COLORS.B : 0xaaaaaa
        );
        mat.uniforms.uOpacity.value = FACE_OPACITY;

        if (!this.faceComplete.has(key)) {
          // Newly completed — kick off the marker-stroke fill animation.
          this.faceComplete.add(key);
          this.faceAnimTimes.set(key, performance.now());
          mat.uniforms.uFill.value = 0;
        }
      } else {
        mat.uniforms.uOpacity.value = 0.0;
        // Reset tracking if the face reverted to incomplete (undo / reset)
        // so the next completion plays the animation again.
        if (this.faceComplete.has(key)) {
          this.faceComplete.delete(key);
          this.faceAnimTimes.delete(key);
          mat.uniforms.uFill.value = 1;
        }
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
   * The traveling spark slides on a straight start→end lerp — wobble
   * amplitude is sub-pixel at default zoom, so visually identical to
   * hugging the curve, and avoids a three.js getPoint failure mode.
   */
  beginEdgePlaceAnim(key: string, owner: 'A' | 'B') {
    const mesh   = this.edgeMeshes.get(key);
    const sketch = this.edgeSketches.get(key);
    if (!mesh || !sketch) return;

    // Cancel any previous animation on this key
    const prev = this.edgeAnims.get(key);
    if (prev) {
      this.cubeContent.remove(prev.highlight);
      // Restore drawRange on whatever geometry the previous anim was using
      prev.sketch.geoOwned.drawRange.count = Infinity;
      // Free the previous anim's cloned material so it doesn't leak GPU resources
      prev.mat.dispose();
      this.edgeAnims.delete(key);
    }

    // Clone the glow material so this animation can swell its emissive
    // intensity without affecting other in-flight glowing strokes.
    const sourceMat = owner === 'A' ? this.matGlowA : this.matGlowB;
    const animMat = sourceMat.clone();
    animMat.emissiveIntensity = GLOW_INTENSITY_BASE;

    // Apply draw material immediately and clamp drawRange to the very start
    mesh.geometry = sketch.geoOwned;
    mesh.material = animMat;
    sketch.geoOwned.drawRange.start = 0;
    sketch.geoOwned.drawRange.count = 0;

    // Traveling highlight spark — starts at the curve's begin point
    const highlight = new THREE.Mesh(
      this.geoHighlight,
      owner === 'A' ? this.matHighlightA : this.matHighlightB,
    );
    highlight.position.copy(sketch.startPos);
    // Spark rides on the rotating cube — add to cubeContent so it spins
    // with the stroke instead of slipping off as the cube turns.
    this.cubeContent.add(highlight);

    this.edgeAnims.set(key, {
      owner,
      startTime: performance.now(),
      sketch,
      mat:       animMat,
      snapTime:  null,
      highlight,
    });
  }

  /** Call on undo or reset — cancels active animations and clears glow state. */
  clearLastPlaced() {
    // Cancel all in-flight edge animations and restore their owned-tier
    // drawRange so any future render of that geometry shows the full stroke.
    // Also dispose each anim's per-edge cloned glow material — updateEdgeStates
    // will assign a fresh shared material on the next frame.
    for (const [, anim] of this.edgeAnims) {
      this.cubeContent.remove(anim.highlight);
      anim.sketch.geoOwned.drawRange.start = 0;
      anim.sketch.geoOwned.drawRange.count = Infinity;
      anim.mat.dispose();
    }
    this.edgeAnims.clear();

    this.lastPlacedEdgeKey = null;
  }

  raycastEdge(ndc: THREE.Vector2): string | null {
    // Hit meshes live inside cubeContent (which lives inside cubePivot),
    // so their world matrices depend on cubePivot.rotation.y. A click can
    // arrive between a rotation update and the next render, so force a
    // matrix refresh from the pivot down before raycasting — otherwise
    // the raycaster would see stale (pre-rotation) hit cylinder positions
    // and pick the wrong edge while the cube is being dragged.
    this.cubePivot.updateMatrixWorld(true);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(Array.from(this.edgeHitMeshes.values()));
    for (const hit of hits) {
      const key = hit.object.userData.edgeKey as string;
      if (this.validEdgeKeys.has(key)) return key;
    }
    return null;
  }

  /**
   * Set the turntable yaw — the cube spins around its vertical center
   * axis by this angle (radians). Driven by CameraController.getCubeYaw()
   * each frame from Game's loop. Camera, lights, and shadow stay put.
   */
  setCubeYaw(yaw: number) {
    this.cubePivot.rotation.y = yaw;
  }

  // ---------------------------------------------------------------------------
  // Animation ticks (called every frame from tick())
  // ---------------------------------------------------------------------------
  private tickEdgeAnims(now: number) {
    for (const [key, anim] of this.edgeAnims) {
      const mesh = this.edgeMeshes.get(key);
      if (!mesh) { this.edgeAnims.delete(key); continue; }

      // ──────────────────────────────────────────────────────────────────
      // Phase 1: pre-snap — wavy stroke drawing in
      // ──────────────────────────────────────────────────────────────────
      if (anim.snapTime === null) {
        const raw = Math.min((now - anim.startTime) / EDGE_ANIM_MS, 1);
        const p   = easeInOutCubic(raw);

        // Reveal the leading portion of the tube along its curve. drawRange
        // operates on indices, and TubeGeometry emits SKETCH_RADIAL * 6
        // indices per tubular ring — revealing N rings means N * SKETCH_RADIAL
        // * 6 indices, walking the stroke smoothly from start to end.
        const ringsRevealed = Math.max(0, Math.floor(SKETCH_TUBULAR * p));
        anim.sketch.geoOwned.drawRange.count = ringsRevealed * SKETCH_RADIAL * 6;

        // Highlight spark slides straight from start dot to end dot. The
        // wavy stroke's wobble amplitude is sub-pixel at default zoom, so a
        // straight lerp is visually indistinguishable from following the
        // curve — and it sidesteps a three.js CatmullRom getPoint failure
        // mode that previously crashed on every click.
        anim.highlight.position
          .copy(anim.sketch.startPos)
          .lerp(anim.sketch.endPos, p);

        // Glow swell: emissive intensity stays at BASE for the first
        // GLOW_SWELL_START_FRAC of the draw, then ramps smoothly up to
        // PEAK so it's visibly aglow at the snap instant. The brighter
        // pulse softens the perceptual "pop" from wavy → straight.
        if (raw < GLOW_SWELL_START_FRAC) {
          anim.mat.emissiveIntensity = GLOW_INTENSITY_BASE;
        } else {
          const swellRaw = (raw - GLOW_SWELL_START_FRAC) / (1 - GLOW_SWELL_START_FRAC);
          const swell    = easeInOutCubic(swellRaw);
          anim.mat.emissiveIntensity =
            GLOW_INTENSITY_BASE + (GLOW_INTENSITY_PEAK - GLOW_INTENSITY_BASE) * swell;
        }

        if (raw >= 1) {
          // Snap! Restore the wavy geo's draw range (so any future re-use
          // starts clean), swap the visible mesh to the shared straight
          // cylinder, hold the glow at peak, retire the spark, and enter
          // the post-snap decay phase. The peak glow continues for a beat
          // so the eye reads the snap as "pen finishing the stroke" rather
          // than "geometry replaced".
          anim.sketch.geoOwned.drawRange.count = Infinity;
          mesh.geometry = this.geoStraightOwned;
          this.cubeContent.remove(anim.highlight);
          anim.mat.emissiveIntensity = GLOW_INTENSITY_PEAK;
          anim.snapTime = now;
          // For other systems that key off "the most recently placed edge"
          this.lastPlacedEdgeKey = key;
        }

      // ──────────────────────────────────────────────────────────────────
      // Phase 2: post-snap — glow decays from PEAK back to 0 over EDGE_GLOW_MS
      // ──────────────────────────────────────────────────────────────────
      } else {
        const gp = Math.min((now - anim.snapTime) / EDGE_GLOW_MS, 1);
        // Smooth decay curve (ease-out so the tail is gentle)
        const decay = 1 - easeInOutCubic(gp);
        anim.mat.emissiveIntensity = GLOW_INTENSITY_PEAK * decay;

        if (gp >= 1) {
          // Glow finished — settle to the resting (non-emissive) material
          // and free the per-anim material clone.
          mesh.material = anim.owner === 'A' ? this.matPlayerA : this.matPlayerB;
          anim.mat.dispose();
          if (this.lastPlacedEdgeKey === key) this.lastPlacedEdgeKey = null;
          this.edgeAnims.delete(key);
        }
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

  // Drive each active face's uFill from 0 → 1 over FACE_FILL_MS. Linear
  // pacing reads as a steady-handed marker stroke; the back-and-forth
  // serpentine motion itself is encoded in the shader (see FACE_FRAG).
  private tickFaceAnims(now: number) {
    for (const [key, startTime] of this.faceAnimTimes) {
      const mesh = this.faceMeshes.get(key);
      if (!mesh) { this.faceAnimTimes.delete(key); continue; }

      const t   = Math.min((now - startTime) / FACE_FILL_MS, 1);
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uFill.value = t;
      if (t >= 1) this.faceAnimTimes.delete(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Main loop — called every frame from Game.ts instead of render()
  // ---------------------------------------------------------------------------
  // Reusable scratch — distance-to-target lookup used every frame
  private static readonly TICK_TARGET = new THREE.Vector3(1, 1, 1);

  tick(now: number) {
    this.tickEdgeAnims(now);
    this.tickFaceAnims(now);
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

    // Bokeh focal plane sits right at the cube's *front face* (cube extends
    // ±1 unit from its center in each axis) so the closest face reads razor-
    // sharp and the back of the cube collects all the blur. Pulling the plane
    // back from the previous camDist-0.6 offset means front-face details
    // (edges and dots) snap into focus instead of sitting in a soft zone.
    (this.bokehPass.uniforms as Record<string, THREE.IUniform>).focus.value =
      Math.max(0.1, camDist - 1.0);

    // Fade the shadow-catcher floor out gracefully as the camera tilts
    // toward / below the floor's level so it never appears as a visible
    // smudge from low angles. Fade window is anchored to the floor's y
    // (-1.5): full opacity when the camera sits at or above cube center
    // (y >= 1.5), zero by the time the camera reaches the floor level.
    // Note: shadowFloorMat is a ShaderMaterial under the hood; we drive its
    // uOpacity uniform directly because the shader doesn't read material.opacity.
    const camY  = this.camera.position.y;
    const fade  = Math.max(0, Math.min(1, (camY + 1.5) / 3.0));
    const uniforms = (this.shadowFloorMat as unknown as THREE.ShaderMaterial).uniforms;
    uniforms.uOpacity.value = SHADOW_FLOOR_OPACITY * fade;

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
    for (const anim of this.edgeAnims.values()) {
      this.cubeContent.remove(anim.highlight);
      anim.mat.dispose();
    }
    this.edgeAnims.clear();
    // Per-edge sketch geometries (4 tubes per edge)
    for (const sketch of this.edgeSketches.values()) {
      sketch.geoCompleted.dispose();
      sketch.geoOwned.dispose();
    }
    this.edgeSketches.clear();
    this.geoHighlight.dispose();
    this.geoStraightNeutral.dispose();
    this.geoStraightHover.dispose();
    this.geoStraightOwned.dispose();
    for (const geo of this.dotGeometries) geo.dispose();
    this.dotGeometries.length = 0;
    this.shadowFloor.geometry.dispose();
    this.shadowFloorMat.dispose();
    this.composerTarget?.dispose();
    this.renderer.dispose();
  }
}
