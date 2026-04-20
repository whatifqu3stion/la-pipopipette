import { GameState } from './GameState';
import { Renderer } from './Renderer';
import { CameraController } from './CameraController';
import { InputController } from './InputController';
import { buildPoints, edgeKey } from './GameModel';

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
    this.renderer.updateEdgeStates(this.state.getEdgeStates(), validEdgeKeys);
    this.renderer.updateFaceStates(this.state.getFaceStates());
    this.renderer.updateCubeStates(this.state.getCubeStates());
  }

  private bindInput() {
    this.canvas.addEventListener('mousemove', (e) => {
      this.inputCtrl.handleMove(e.clientX, e.clientY);
    });
    this.canvas.addEventListener('click', (e) => {
      this.inputCtrl.handleClick(e.clientX, e.clientY);
    });
    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      this.inputCtrl.handleClick(touch.clientX, touch.clientY);
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this.inputCtrl.handleMove(touch.clientX, touch.clientY);
    }, { passive: false });

    this.inputCtrl.onPlace((placedKey, placedOwner) => {
      this.syncRendererWithState();
      this.renderer.setLastPlacedEdge(placedKey, placedOwner);
      this.stateChangeCallback?.();
    });

    this.state.on(() => {
      this.stateChangeCallback?.();
    });

    const ro = new ResizeObserver(() => {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (w > 0 && h > 0) this.renderer.resize(w, h);
    });
    ro.observe(this.canvas);
  }

  private startLoop() {
    const loop = (now: number) => {
      this.cameraCtrl.update(now);
      this.renderer.render();
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

  dispose() {
    if (this.animFrameId !== null) cancelAnimationFrame(this.animFrameId);
    this.renderer.dispose();
  }
}
