import * as THREE from 'three';

const TARGET = new THREE.Vector3(1, 1, 1);

// Bounding sphere radius that comfortably contains the 2×2×2 cube
// (half diagonal = sqrt(3) ≈ 1.732) plus padding for the corner dots & edges.
const CUBE_BOUND_R = 2.05;

// Pixels of viewport vertical space reserved for the top + bottom UI bars.
// The cube renders centered in the canvas, so we shrink the "usable" height
// when computing fit distance to make sure the cube clears both bars.
const UI_RESERVE_PX = 170;

// Hard floors so the camera never sits inside the structure.
const ZOOM_MIN_FLOOR = 3.5;
// Maximum zoom-out is a *relative* multiplier of the per-viewport fit distance
// — no absolute ceiling. This guarantees the cube is always visibly larger
// than ~70% of its fit-size, so the user can never zoom out to "lose" it.
const ZOOM_MAX_FIT_MULTIPLIER = 1.35;

// Fallback values used before the first setViewport() call.
const ZOOM_DEFAULT_FALLBACK = 7;
const ZOOM_MIN_FALLBACK     = 4.5;
const ZOOM_MAX_FALLBACK     = 13;

// Default elevation: 45° — true 3/4 view, interior structure clearly visible.
const ELEVATION_DEFAULT = Math.PI / 4;
// Vertical clamp: stop short of straight-up / straight-down to avoid the
// camera-up singularity at the poles. ±75° gives a wide range that includes
// looking down at the top face and up at the bottom face.
const ELEVATION_MIN     = -(75 * Math.PI) / 180;
const ELEVATION_MAX     =  (75 * Math.PI) / 180;
// Snap step for elevation on drag-release — finer than the 90° azimuth snap
// so users can rest at intermediate top/bottom angles.
const ELEVATION_STEP    = (15 * Math.PI) / 180;

const ROTATION_DURATION = 300; // ms — main sweep
const SETTLE_DURATION   = 100; // ms — settle after overshoot
const OVERSHOOT_MAX_DEG = 3;   // degrees — max overshoot for button rotation

// Four preset diagonal azimuths: 45°, 135°, 225°, 315°
const DIAGONAL_START = Math.PI / 4;
const STEP           = Math.PI / 2;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class CameraController {
  private camera: THREE.PerspectiveCamera;

  private currentAngle     = DIAGONAL_START;
  private currentElevation = ELEVATION_DEFAULT;

  // Dynamic zoom range — recomputed by setViewport() based on aspect ratio.
  private zoomDist     = ZOOM_DEFAULT_FALLBACK;
  private zoomDefault  = ZOOM_DEFAULT_FALLBACK;
  private zoomMin      = ZOOM_MIN_FALLBACK;
  private zoomMax      = ZOOM_MAX_FALLBACK;

  // Track whether the user has pinched/zoomed since the last reset.  If they
  // have, viewport changes preserve their zoom (clamped to the new range);
  // otherwise we re-fit to the new default.
  private hasUserZoomed = false;

  // Animation
  private isAnimating      = false;
  private animStartTime    = 0;
  private animStartAngle   = 0;
  private animTargetAngle  = 0;
  private animStartElev    = ELEVATION_DEFAULT;
  private animTargetElev   = ELEVATION_DEFAULT;
  private animOvershootRad = 0; // set per animation; proportional for snaps, max for buttons

  private onAnimationComplete: (() => void) | null = null;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.updateCameraPosition();
  }

  // ---------------------------------------------------------------------------
  // Internal position update
  // ---------------------------------------------------------------------------
  private updateCameraPosition() {
    const r  = this.zoomDist;
    const el = this.currentElevation;
    this.camera.position.set(
      TARGET.x + r * Math.cos(el) * Math.sin(this.currentAngle),
      TARGET.y + r * Math.sin(el),
      TARGET.z + r * Math.cos(el) * Math.cos(this.currentAngle),
    );
    this.camera.lookAt(TARGET);
  }

  // ---------------------------------------------------------------------------
  // Button rotation — full 90° azimuth step with max overshoot.
  // Elevation is held fixed so the view doesn't drift vertically when the
  // user only asked to rotate horizontally.
  // ---------------------------------------------------------------------------
  rotate(direction: 'left' | 'right'): boolean {
    if (this.isAnimating) return false;

    const delta = direction === 'left' ? -STEP : STEP;
    this.animStartAngle   = this.currentAngle;
    this.animTargetAngle  = this.currentAngle + delta;
    this.animStartElev    = this.currentElevation;
    this.animTargetElev   = this.currentElevation;
    this.animOvershootRad = (OVERSHOOT_MAX_DEG * Math.PI) / 180;
    this.animStartTime    = performance.now();
    this.isAnimating      = true;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Drag navigation — called continuously during a pointer drag gesture.
  // dragBy = horizontal (azimuth), dragByVertical = vertical (elevation).
  // ---------------------------------------------------------------------------
  dragBy(deltaAngle: number) {
    if (this.isAnimating) return; // button rotation has priority
    this.currentAngle += deltaAngle;
    this.updateCameraPosition();
  }

  dragByVertical(deltaAngle: number) {
    if (this.isAnimating) return; // button rotation has priority
    this.currentElevation = clamp(
      this.currentElevation + deltaAngle,
      ELEVATION_MIN,
      ELEVATION_MAX,
    );
    this.updateCameraPosition();
  }

  // ---------------------------------------------------------------------------
  // Snap — call on drag release; animates to nearest canonical preset on
  // both azimuth (90° steps) and elevation (15° steps, clamped).
  // ---------------------------------------------------------------------------
  snapToNearest() {
    if (this.isAnimating) return; // button rotation has priority

    const snappedAz = Math.round((this.currentAngle - DIAGONAL_START) / STEP) * STEP + DIAGONAL_START;
    const snappedEl = clamp(
      Math.round(this.currentElevation / ELEVATION_STEP) * ELEVATION_STEP,
      ELEVATION_MIN,
      ELEVATION_MAX,
    );

    const distAz = Math.abs(snappedAz - this.currentAngle);
    const distEl = Math.abs(snappedEl - this.currentElevation);
    const dist   = Math.max(distAz, distEl);

    // Proportional overshoot — capped at OVERSHOOT_MAX_DEG.
    // For a tiny drift (< 5°), overshoot is nearly zero.
    this.animOvershootRad = Math.min((OVERSHOOT_MAX_DEG * Math.PI) / 180, dist * 0.18);
    this.animStartAngle   = this.currentAngle;
    this.animTargetAngle  = snappedAz;
    this.animStartElev    = this.currentElevation;
    this.animTargetElev   = snappedEl;
    this.animStartTime    = performance.now();
    this.isAnimating      = true;
  }

  // ---------------------------------------------------------------------------
  // Pinch zoom — factor > 1 means fingers spreading (zoom in = shorter distance)
  // ---------------------------------------------------------------------------
  zoom(factor: number) {
    this.hasUserZoomed = true;
    this.zoomDist = Math.max(this.zoomMin, Math.min(this.zoomMax, this.zoomDist / factor));
    this.updateCameraPosition();
  }

  // ---------------------------------------------------------------------------
  // Viewport sync — call from the ResizeObserver.  Computes a fit distance
  // that keeps the cube fully visible *and* clear of the top/bottom UI bars
  // for the given canvas size.  Updates default/min/max zoom accordingly and
  // re-fits the current zoom if the user hasn't manually pinched yet.
  // ---------------------------------------------------------------------------
  setViewport(width: number, height: number) {
    if (width <= 0 || height <= 0) return;

    const halfFovV = (this.camera.fov * Math.PI / 180) / 2;
    const tanHalfV = Math.tan(halfFovV);
    const aspect   = width / height;

    // Horizontal fit: hfov = 2 * atan(tan(vfov/2) * aspect)
    // Distance to fit a sphere of radius R horizontally: R / (tanHalfV * aspect)
    const distH = CUBE_BOUND_R / (tanHalfV * Math.max(0.1, aspect));

    // Vertical fit: shrink the usable height by the UI-bar reserve so the cube
    // doesn't render behind the floating top/bottom bars.  Cube renders centered
    // in the canvas, so the *effective* vertical FOV the cube can occupy is
    // (usableH / fullH) of the total — we boost the distance by the inverse.
    const usableH    = Math.max(120, height - UI_RESERVE_PX);
    const heightBoost = height / usableH;
    const distV       = (CUBE_BOUND_R / tanHalfV) * heightBoost;

    const fitDist = Math.max(distH, distV);

    // Default sits a little above fit so there's a small frame around the cube.
    this.zoomDefault = fitDist * 1.05;

    // Allow the user to zoom in moderately closer than fit, but never inside
    // the structure.  Zoom-out is capped at a *relative* multiplier of the
    // fit distance so the cube always stays comfortably visible — never
    // letting the user pinch out into "where is the cube?" territory.
    this.zoomMin = Math.max(ZOOM_MIN_FLOOR, fitDist * 0.55);
    this.zoomMax = fitDist * ZOOM_MAX_FIT_MULTIPLIER;

    // If the user hasn't pinch-zoomed yet, snap to the new default; otherwise
    // just clamp their existing zoom into the new valid range.
    if (!this.hasUserZoomed) {
      this.zoomDist = this.zoomDefault;
    } else {
      this.zoomDist = Math.max(this.zoomMin, Math.min(this.zoomMax, this.zoomDist));
    }

    this.updateCameraPosition();
  }

  // ---------------------------------------------------------------------------
  // Animation tick — called every frame from Game.ts
  // ---------------------------------------------------------------------------
  update(now: number): boolean {
    if (!this.isAnimating) return false;

    const elapsed       = now - this.animStartTime;
    const totalDuration = ROTATION_DURATION + SETTLE_DURATION;

    if (elapsed >= totalDuration) {
      this.currentAngle     = this.animTargetAngle;
      this.currentElevation = this.animTargetElev;
      this.isAnimating      = false;
      this.updateCameraPosition();
      this.onAnimationComplete?.();
      this.onAnimationComplete = null;
      return false;
    }

    const dirAz = this.animTargetAngle >= this.animStartAngle ? 1 : -1;

    if (elapsed < ROTATION_DURATION) {
      // easeInOut sweep with overshoot applied as a sine bump
      const t     = elapsed / ROTATION_DURATION;
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      this.currentAngle =
        this.animStartAngle +
        (this.animTargetAngle - this.animStartAngle) * eased +
        dirAz * this.animOvershootRad * Math.sin(eased * Math.PI);
      // Elevation eases in lockstep (no overshoot — vertical bounce feels off).
      this.currentElevation =
        this.animStartElev +
        (this.animTargetElev - this.animStartElev) * eased;
    } else {
      // Settle: ease azimuth back from overshoot to exact target; elevation
      // already finished (no overshoot) so just lock it.
      const st    = (elapsed - ROTATION_DURATION) / SETTLE_DURATION;
      const eased = 1 - (1 - st) * (1 - st);
      this.currentAngle = this.animTargetAngle + dirAz * this.animOvershootRad * (1 - eased);
      this.currentElevation = this.animTargetElev;
    }

    this.updateCameraPosition();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Misc
  // ---------------------------------------------------------------------------
  isRotating(): boolean {
    return this.isAnimating;
  }

  onComplete(cb: () => void) {
    this.onAnimationComplete = cb;
  }

  reset() {
    this.currentAngle     = DIAGONAL_START;
    this.currentElevation = ELEVATION_DEFAULT;
    this.zoomDist         = this.zoomDefault;
    this.hasUserZoomed    = false;
    this.isAnimating      = false;
    this.updateCameraPosition();
  }
}
