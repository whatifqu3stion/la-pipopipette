import * as THREE from 'three';
import type { Renderer } from './Renderer';
import type { GameState } from './GameState';
import { edgeKey } from './GameModel';

export class InputController {
  private renderer: Renderer;
  private state: GameState;
  private canvas: HTMLCanvasElement;
  private enabled = true;

  private onEdgePlaced: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, renderer: Renderer, state: GameState) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.state = state;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  onPlace(cb: () => void) {
    this.onEdgePlaced = cb;
  }

  handleMove(clientX: number, clientY: number) {
    if (!this.enabled) {
      this.renderer.setHoveredEdge(null);
      return;
    }

    const ndc = this.clientToNDC(clientX, clientY);
    const hitKey = this.renderer.raycastEdge(ndc);
    this.renderer.setHoveredEdge(hitKey);
  }

  handleClick(clientX: number, clientY: number) {
    if (!this.enabled) return;
    if (this.state.isGameOver()) return;

    const ndc = this.clientToNDC(clientX, clientY);
    const hitKey = this.renderer.raycastEdge(ndc);
    if (!hitKey) return;

    // Find the edge from the key
    const edges = this.state.getEdgeStates();
    const edgeState = edges.find(e => edgeKey(e.edge) === hitKey);
    if (!edgeState) return;

    const placed = this.state.placeEdge(edgeState.edge);
    if (placed && this.onEdgePlaced) {
      this.onEdgePlaced();
    }
  }

  private clientToNDC(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }
}
