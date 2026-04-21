import * as THREE from 'three';

const TARGET = new THREE.Vector3(1, 1, 1);

const ZOOM_DEFAULT = 7;
const ZOOM_MIN     = 4.5;  // can't go inside the structure
const ZOOM_MAX     = 13;   // board always visible

// 45° elevation: true 3/4 view — interior structure clearly visible
const CAMERA_ELEVATION = Math.PI / 4;

const ROTATION_DURATION = 300; // ms — main sweep
const SETTLE_DURATION   = 100; // ms — settle after overshoot
const OVERSHOOT_MAX_DEG = 3;   // degrees — max overshoot for button rotation

// Four preset diagonal azimuths: 45°, 135°, 225°, 315°
const DIAGONAL_START = Math.PI / 4;
const STEP           = Math.PI / 2;

export class CameraController {
  private camera: THREE.PerspectiveCamera;

  private currentAngle = DIAGONAL_START;
  private zoomDist     = ZOOM_DEFAULT;

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
  // Internal position update
  // ---------------------------------------------------------------------------
  private updateCameraPosition() {
    const r = this.zoomDist;
    const el = CAMERA_ELEVATION;
    this.camera.position.set(
      TARGET.x + r * Math.cos(el) * Math.sin(this.currentAngle),
      TARGET.y + r * Math.sin(el),
      TARGET.z + r * Math.cos(el) * Math.cos(this.currentAngle),
    );
    this.camera.lookAt(TARGET);
  }

  // ---------------------------------------------------------------------------
  // Button rotation — full 90° step with max overshoot
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
  // Drag navigation — called continuously during a pointer drag gesture
  // ---------------------------------------------------------------------------
  dragBy(deltaAngle: number) {
    if (this.isAnimating) return; // button rotation has priority
    this.currentAngle += deltaAngle;
    this.updateCameraPosition();
  }

  // ---------------------------------------------------------------------------
  // Snap — call on drag release; animates to nearest canonical preset
  // ---------------------------------------------------------------------------
  snapToNearest() {
    if (this.isAnimating) return; // button rotation has priority

    // Round to nearest multiple of STEP, offset by DIAGONAL_START
    const snapped = Math.round((this.currentAngle - DIAGONAL_START) / STEP) * STEP + DIAGONAL_START;
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
    this.zoomDist = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoomDist / factor));
    this.updateCameraPosition();
  }

  // ---------------------------------------------------------------------------
  // Animation tick — called every frame from Game.ts
  // ---------------------------------------------------------------------------
  update(now: number): boolean {
    if (!this.isAnimating) return false;

    const elapsed      = now - this.animStartTime;
    const totalDuration = ROTATION_DURATION + SETTLE_DURATION;

    if (elapsed >= totalDuration) {
      this.currentAngle = this.animTargetAngle;
      this.isAnimating  = false;
      this.updateCameraPosition();
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
      // Settle: ease back from overshoot position to exact target
      const st    = (elapsed - ROTATION_DURATION) / SETTLE_DURATION;
      const eased = 1 - (1 - st) * (1 - st);
      this.currentAngle = this.animTargetAngle + dir * this.animOvershootRad * (1 - eased);
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
    this.currentAngle    = DIAGONAL_START;
    this.zoomDist        = ZOOM_DEFAULT;
    this.isAnimating     = false;
    this.updateCameraPosition();
  }
}
