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

// Fixed camera azimuth and elevation — in turntable mode the camera never
// moves around the cube; it sits at this 3/4 view and the cube spins on
// its own vertical axis instead. Pinch-zoom adjusts only the radius.
const CAMERA_AZIMUTH   = Math.PI / 4; // diagonal corner view
const CAMERA_ELEVATION = Math.PI / 4; // 45° down — true 3/4 view

const ROTATION_DURATION = 300; // ms — main sweep
const SETTLE_DURATION   = 100; // ms — settle after overshoot
const OVERSHOOT_MAX_DEG = 3;   // degrees — max overshoot for button rotation

// Snap step for cube yaw — 90° quarter turns.
const STEP = Math.PI / 2;

export class CameraController {
  private camera: THREE.PerspectiveCamera;

  // Cube yaw — the value the renderer's cubePivot.rotation.y is driven from
  // each frame (negated, see getCubeYaw). Starts at zero so the cube faces
  // its "home" orientation; snapping rests at multiples of STEP (90°).
  private currentAngle = 0;

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
  private animOvershootRad = 0; // set per animation; proportional for snaps, max for buttons

  private onAnimationComplete: (() => void) | null = null;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.updateCameraPosition();
  }

  // ---------------------------------------------------------------------------
  // Camera position update — only ever changes with zoom now. Azimuth and
  // elevation are fixed in turntable mode (the cube does the rotating).
  // ---------------------------------------------------------------------------
  private updateCameraPosition() {
    const r  = this.zoomDist;
    const az = CAMERA_AZIMUTH;
    const el = CAMERA_ELEVATION;
    this.camera.position.set(
      TARGET.x + r * Math.cos(el) * Math.sin(az),
      TARGET.y + r * Math.sin(el),
      TARGET.z + r * Math.cos(el) * Math.cos(az),
    );
    this.camera.lookAt(TARGET);
  }

  // ---------------------------------------------------------------------------
  // Cube yaw read by Renderer.setCubeYaw each frame.
  //
  // Negated so the rotation direction matches the previous camera-orbit
  // model: clicking "rotate right" advances currentAngle by +STEP, which
  // produces a clockwise-from-above cube spin — visually identical to the
  // old behaviour where the camera walked counter-clockwise around a
  // stationary cube ("front face moves to the user's right").
  // ---------------------------------------------------------------------------
  getCubeYaw(): number {
    return -this.currentAngle;
  }

  // ---------------------------------------------------------------------------
  // Button rotation — full 90° step with max overshoot.
  // ---------------------------------------------------------------------------
  rotate(direction: 'left' | 'right'): boolean {
    if (this.isAnimating) return false;

    const delta = direction === 'left' ? -STEP : STEP;
    this.animStartAngle   = this.currentAngle;
    this.animTargetAngle  = this.currentAngle + delta;
    this.animOvershootRad = (OVERSHOOT_MAX_DEG * Math.PI) / 180;
    this.animStartTime    = performance.now();
    this.isAnimating      = true;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Drag navigation — horizontal drag only. Vertical drag is intentionally
  // NOT wired up: turntable feel means the cube spins on its vertical axis
  // and the ground/shadow stay anchored at the bottom of the screen.
  // ---------------------------------------------------------------------------
  dragBy(deltaAngle: number) {
    if (this.isAnimating) return; // button rotation has priority
    this.currentAngle += deltaAngle;
  }

  // ---------------------------------------------------------------------------
  // Snap — call on drag release; animates the cube's yaw to the nearest
  // 90° quarter turn (multiples of STEP from 0).
  // ---------------------------------------------------------------------------
  snapToNearest() {
    if (this.isAnimating) return; // button rotation has priority

    const snapped = Math.round(this.currentAngle / STEP) * STEP;
    const dist    = Math.abs(snapped - this.currentAngle);

    // Proportional overshoot — capped at OVERSHOOT_MAX_DEG.
    // For a tiny drift (< 5°), overshoot is nearly zero.
    this.animOvershootRad = Math.min((OVERSHOOT_MAX_DEG * Math.PI) / 180, dist * 0.18);
    this.animStartAngle   = this.currentAngle;
    this.animTargetAngle  = snapped;
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
  // Animation tick — called every frame from Game.ts. Only currentAngle
  // animates; camera position doesn't change here (zoom is driven by zoom()).
  // ---------------------------------------------------------------------------
  update(now: number): boolean {
    if (!this.isAnimating) return false;

    const elapsed       = now - this.animStartTime;
    const totalDuration = ROTATION_DURATION + SETTLE_DURATION;

    if (elapsed >= totalDuration) {
      this.currentAngle = this.animTargetAngle;
      this.isAnimating  = false;
      this.onAnimationComplete?.();
      this.onAnimationComplete = null;
      return false;
    }

    const dir = this.animTargetAngle >= this.animStartAngle ? 1 : -1;

    if (elapsed < ROTATION_DURATION) {
      // easeInOut sweep with overshoot applied as a sine bump
      const t     = elapsed / ROTATION_DURATION;
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      this.currentAngle =
        this.animStartAngle +
        (this.animTargetAngle - this.animStartAngle) * eased +
        dir * this.animOvershootRad * Math.sin(eased * Math.PI);
    } else {
      // Settle: ease back from overshoot to exact target.
      const st    = (elapsed - ROTATION_DURATION) / SETTLE_DURATION;
      const eased = 1 - (1 - st) * (1 - st);
      this.currentAngle = this.animTargetAngle + dir * this.animOvershootRad * (1 - eased);
    }

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
    this.currentAngle  = 0;
    this.zoomDist      = this.zoomDefault;
    this.hasUserZoomed = false;
    this.isAnimating   = false;
    this.updateCameraPosition();
  }
}
