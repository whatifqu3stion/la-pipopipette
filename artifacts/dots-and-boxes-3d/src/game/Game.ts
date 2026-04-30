import { GameState } from './GameState';
import { Renderer, type AtmosphereParams } from './Renderer';
import { CameraController } from './CameraController';
import { InputController } from './InputController';
import { buildPoints, edgeKey, getCubeEdges } from './GameModel';

export class Game {
  private state: GameState;
  private renderer: Renderer;
  private cameraCtrl: CameraController;
  private inputCtrl: InputController;
  private canvas: HTMLCanvasElement;
  private animFrameId: number | null = null;
  private stateChangeCallback: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.state = new GameState();
    this.renderer = new Renderer(canvas);
    this.cameraCtrl = new CameraController(this.renderer.camera);
    this.inputCtrl = new InputController(canvas, this.renderer, this.state);

    this.initScene();
    this.bindInput();
    this.startLoop();
  }

  private initScene() {
    const points = buildPoints();
    this.renderer.initPoints(points);
    this.renderer.initEdges(this.state.getEdgeStates());
    this.renderer.initFaces(this.state.getFaceStates());
    this.renderer.initCubes(this.state.getCubeStates());
    this.syncRendererWithState();
  }

  private syncRendererWithState() {
    const validEdgeKeys = new Set(this.state.getValidEdges().map(e => edgeKey(e)));

    // Build a map of edgeKey → cube-owner for every edge that belongs to a
    // completed cube.  Edges shared between two completed cubes get the last
    // writer's colour — acceptable since both cubes are already done.
    const completedCubeEdgeOwner = new Map<string, 'A' | 'B'>();
    for (const { cube, complete, owner } of this.state.getCubeStates()) {
      if (complete && owner) {
        for (const edge of getCubeEdges(cube)) {
          completedCubeEdgeOwner.set(edgeKey(edge), owner);
        }
      }
    }

    this.renderer.updateEdgeStates(this.state.getEdgeStates(), validEdgeKeys, completedCubeEdgeOwner);
    this.renderer.updateFaceStates(this.state.getFaceStates());
    this.renderer.updateCubeStates(this.state.getCubeStates());
  }

  private bindInput() {
    const canvas = this.canvas;

    // Pixels of movement before we commit to drag-rotate (vs tap-to-place)
    const DRAG_THRESHOLD = 8;
    // Radians of rotation per pixel of drag.
    // π / 500 ≈ a full 500 px swipe rotates 180°, so ~250 px ≈ 90°.
    // Same factor for horizontal (azimuth) and vertical (elevation) drag.
    const DRAG_FACTOR = Math.PI / 500;

    // ── Mouse ──────────────────────────────────────────────────────────────
    let mouseDown     = false;
    let mouseStartX   = 0;
    let mouseStartY   = 0;
    let mousePrevX    = 0;
    let mousePrevY    = 0;
    let mouseDragging = false;

    canvas.addEventListener('mousedown', (e) => {
      mouseDown     = true;
      mouseStartX   = e.clientX;
      mouseStartY   = e.clientY;
      mousePrevX    = e.clientX;
      mousePrevY    = e.clientY;
      mouseDragging = false;
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!mouseDown) {
        this.inputCtrl.handleMove(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - mousePrevX;
      const dy = e.clientY - mousePrevY;
      mousePrevX = e.clientX;
      mousePrevY = e.clientY;

      const totalDrag = Math.hypot(e.clientX - mouseStartX, e.clientY - mouseStartY);
      if (!mouseDragging && totalDrag > DRAG_THRESHOLD) {
        mouseDragging = true;
        this.inputCtrl.setEnabled(false);
        this.renderer.setHoveredEdge(null);
      }
      if (mouseDragging) {
        // Horizontal drag spins the cube (turntable yaw); vertical drag
        // tilts the camera elevation. Pass dy as-is so dragging *down*
        // tips the cube's top toward the viewer (reveals the top face),
        // and dragging up reveals more of the side.
        this.cameraCtrl.dragBy(dx * DRAG_FACTOR);
        this.cameraCtrl.dragByVertical(dy * DRAG_FACTOR);
      } else {
        this.inputCtrl.handleMove(e.clientX, e.clientY);
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      if (!mouseDown) return;
      mouseDown = false;
      if (mouseDragging) {
        mouseDragging = false;
        // No snap on release — the cube rests at whatever angle the user
        // settled on so they can reach edges between snap points.
        this.inputCtrl.setEnabled(true);
      } else {
        this.inputCtrl.handleClick(e.clientX, e.clientY);
      }
    });

    canvas.addEventListener('mouseleave', () => {
      if (mouseDragging) {
        this.inputCtrl.setEnabled(true);
      }
      mouseDown     = false;
      mouseDragging = false;
      this.renderer.setHoveredEdge(null);
    });

    // ── Touch ──────────────────────────────────────────────────────────────
    let touchStartX   = 0;
    let touchStartY   = 0;
    let touchPrevX    = 0;
    let touchPrevY    = 0;
    let touchDragging = false;
    let touchPinching = false;
    let pinchPrevDist = 0;

    const getPinchDist = (touches: TouchList) =>
      Math.hypot(
        touches[1].clientX - touches[0].clientX,
        touches[1].clientY - touches[0].clientY,
      );

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t      = e.touches[0];
        touchStartX  = touchPrevX = t.clientX;
        touchStartY  = touchPrevY = t.clientY;
        touchDragging = false;
        touchPinching = false;
      } else if (e.touches.length === 2) {
        // Second finger down — commit to pinch, cancel any ongoing drag
        touchPinching  = true;
        touchDragging  = false;
        pinchPrevDist  = getPinchDist(e.touches);
        this.renderer.setHoveredEdge(null);
        this.inputCtrl.setEnabled(true); // restore in case drag was active
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (touchPinching && e.touches.length >= 2) {
        const d      = getPinchDist(e.touches);
        const factor = d / pinchPrevDist;
        this.cameraCtrl.zoom(factor);
        pinchPrevDist = d;
        return;
      }
      if (!touchPinching && e.touches.length === 1) {
        const t   = e.touches[0];
        const dx  = t.clientX - touchPrevX;
        const dy  = t.clientY - touchPrevY;
        touchPrevX = t.clientX;
        touchPrevY = t.clientY;

        const totalDrag = Math.hypot(
          t.clientX - touchStartX,
          t.clientY - touchStartY,
        );
        if (!touchDragging && totalDrag > DRAG_THRESHOLD) {
          touchDragging = true;
          this.inputCtrl.setEnabled(false);
          this.renderer.setHoveredEdge(null);
        }
        if (touchDragging) {
          // Horizontal swipe spins the cube; vertical swipe tilts the
          // camera elevation. Swipe down = peek at the top of the cube.
          this.cameraCtrl.dragBy(dx * DRAG_FACTOR);
          this.cameraCtrl.dragByVertical(dy * DRAG_FACTOR);
        } else {
          this.inputCtrl.handleMove(t.clientX, t.clientY);
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (touchPinching) {
        if (e.touches.length < 2) touchPinching = false;
        return;
      }
      if (touchDragging) {
        touchDragging = false;
        // No snap on release — see mouseup handler above.
        this.inputCtrl.setEnabled(true);
      } else {
        // Short tap — place edge
        const t = e.changedTouches[0];
        this.inputCtrl.handleClick(t.clientX, t.clientY);
      }
    }, { passive: false });

    canvas.addEventListener('touchcancel', () => {
      if (touchDragging) {
        this.inputCtrl.setEnabled(true);
      }
      touchDragging = false;
      touchPinching = false;
      this.renderer.setHoveredEdge(null);
    });

    // ── Game logic callbacks ───────────────────────────────────────────────
    this.inputCtrl.onPlace((placedKey, placedOwner) => {
      this.syncRendererWithState();
      this.renderer.beginEdgePlaceAnim(placedKey, placedOwner);
      this.stateChangeCallback?.();
    });

    this.state.on(() => {
      this.stateChangeCallback?.();
    });

    // ── Resize ────────────────────────────────────────────────────────────
    // Both the renderer (canvas size + projection aspect) and the camera
    // controller (fit-distance + zoom range) need to react to viewport
    // changes — so the cube always fits cleanly between the floating UI bars
    // on any screen from a 320 px phone to a 4K desktop.
    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w > 0 && h > 0) {
        this.renderer.resize(w, h);
        this.cameraCtrl.setViewport(w, h);
      }
    });
    ro.observe(canvas);

    // Initial fit — ResizeObserver fires async, so do one synchronous pass
    // here so the very first frame already has a sensible camera distance.
    const w0 = canvas.clientWidth;
    const h0 = canvas.clientHeight;
    if (w0 > 0 && h0 > 0) {
      this.renderer.resize(w0, h0);
      this.cameraCtrl.setViewport(w0, h0);
    }
  }

  private startLoop() {
    const loop = (now: number) => {
      // Update tween state (button rotations and snap-back animations).
      this.cameraCtrl.update(now);
      // Push the latest cube yaw into the renderer so the turntable group
      // reflects this frame's rotation before render.
      this.renderer.setCubeYaw(this.cameraCtrl.getCubeYaw());
      this.renderer.tick(now);
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  setStateChangeCallback(cb: () => void) {
    this.stateChangeCallback = cb;
  }

  rotateCamera(dir: 'left' | 'right') {
    if (!this.cameraCtrl.isRotating()) {
      this.inputCtrl.setEnabled(false);
      this.cameraCtrl.rotate(dir);
      const checkDone = () => {
        if (!this.cameraCtrl.isRotating()) {
          this.inputCtrl.setEnabled(true);
        } else {
          setTimeout(checkDone, 50);
        }
      };
      setTimeout(checkDone, 50);
    }
  }

  undo() {
    if (this.state.undo()) {
      this.renderer.clearLastPlaced();
      this.syncRendererWithState();
      this.stateChangeCallback?.();
    }
  }

  canUndo(): boolean {
    return this.state.canUndoMove();
  }

  reset() {
    this.state.reset();
    this.cameraCtrl.reset();
    // Apply the reset yaw immediately so the cube snaps back to its home
    // orientation on the same frame as the rest of the reset, instead of
    // the next render loop tick.
    this.renderer.setCubeYaw(this.cameraCtrl.getCubeYaw());
    this.renderer.clearLastPlaced();
    this.syncRendererWithState();
    this.stateChangeCallback?.();
  }

  getCurrentPlayer(): 'A' | 'B' {
    return this.state.getCurrentPlayer();
  }

  getScores(): { A: number; B: number } {
    return this.state.getScores();
  }

  isGameOver(): boolean {
    return this.state.isGameOver();
  }

  getWinner() {
    return this.state.getWinner();
  }

  // Forward atmosphere-pass tuning to the renderer. Called from React when
  // the user moves a slider in the in-app tuning panel.
  setAtmosphereParams(params: Partial<AtmosphereParams>) {
    this.renderer.setAtmosphereParams(params);
  }

  dispose() {
    if (this.animFrameId !== null) cancelAnimationFrame(this.animFrameId);
    this.renderer.dispose();
  }
}
