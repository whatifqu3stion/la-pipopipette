import {
  buildEdges, buildFaces, buildCubes,
  getFaceEdges, getCubeFaces,
  edgeKey, faceKey, cubeKey
} from './GameModel';
import type {
  Edge, Face, Cube, Owner,
  EdgeState, FaceState, CubeState, GameSnapshot, GameEvent
} from './types';

export class GameState {
  private edgeMap = new Map<string, EdgeState>();
  private faceMap = new Map<string, FaceState>();
  private cubeMap = new Map<string, CubeState>();

  private currentPlayer: 'A' | 'B';
  private scores: { A: number; B: number } = { A: 0, B: 0 };
  private gameOver = false;
  private winner: Owner = null;

  private undoStack: GameSnapshot[] = [];
  private canUndo = false;

  private eventListeners: Array<(event: GameEvent) => void> = [];

  constructor() {
    const edges = buildEdges();
    const faces = buildFaces();
    const cubes = buildCubes();

    for (const e of edges)
      this.edgeMap.set(edgeKey(e), { edge: e, owner: null });

    for (const f of faces)
      this.faceMap.set(faceKey(f), { face: f, owner: null, complete: false });

    for (const c of cubes)
      this.cubeMap.set(cubeKey(c), { cube: c, owner: null, complete: false });

    // Randomize starting player
    this.currentPlayer = Math.random() < 0.5 ? 'A' : 'B';
  }

  on(listener: (event: GameEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter(l => l !== listener);
    };
  }

  private emit(event: GameEvent) {
    for (const l of this.eventListeners) l(event);
  }

  getSnapshot(): GameSnapshot {
    return {
      edges: Array.from(this.edgeMap.values()).map(e => ({ ...e, edge: { ...e.edge, start: { ...e.edge.start } } })),
      faces: Array.from(this.faceMap.values()).map(f => ({ ...f, face: { ...f.face, origin: { ...f.face.origin } } })),
      cubes: Array.from(this.cubeMap.values()).map(c => ({ ...c, cube: { ...c.cube, origin: { ...c.cube.origin } } })),
      currentPlayer: this.currentPlayer,
      scores: { ...this.scores },
      gameOver: this.gameOver,
      winner: this.winner,
    };
  }

  private restoreSnapshot(snap: GameSnapshot) {
    this.edgeMap.clear();
    this.faceMap.clear();
    this.cubeMap.clear();

    for (const e of snap.edges) this.edgeMap.set(edgeKey(e.edge), { ...e });
    for (const f of snap.faces) this.faceMap.set(faceKey(f.face), { ...f });
    for (const c of snap.cubes) this.cubeMap.set(cubeKey(c.cube), { ...c });

    this.currentPlayer = snap.currentPlayer;
    this.scores = { ...snap.scores };
    this.gameOver = snap.gameOver;
    this.winner = snap.winner;
  }

  getCurrentPlayer(): 'A' | 'B' {
    return this.currentPlayer;
  }

  getScores() {
    return { ...this.scores };
  }

  isGameOver() {
    return this.gameOver;
  }

  getWinner() {
    return this.winner;
  }

  getEdgeStates(): EdgeState[] {
    return Array.from(this.edgeMap.values());
  }

  getFaceStates(): FaceState[] {
    return Array.from(this.faceMap.values());
  }

  getCubeStates(): CubeState[] {
    return Array.from(this.cubeMap.values());
  }

  /** All unplaced edges are valid — gravity rule removed. */
  isEdgeValid(edge: Edge): boolean {
    return this.edgeMap.get(edgeKey(edge))?.owner === null;
  }

  getValidEdges(): Edge[] {
    return Array.from(this.edgeMap.values())
      .filter(es => es.owner === null && this.isEdgeValid(es.edge))
      .map(es => es.edge);
  }

  /**
   * Place an edge for the current player.
   * Returns false if the move is invalid.
   */
  placeEdge(edge: Edge): boolean {
    if (this.gameOver) return false;
    if (!this.isEdgeValid(edge)) return false;

    // Save undo snapshot
    this.undoStack = [this.getSnapshot()];
    this.canUndo = true;

    const player = this.currentPlayer;
    const key = edgeKey(edge);
    const es = this.edgeMap.get(key)!;
    es.owner = player;

    this.emit({ type: 'edgePlaced', edge, player });

    // Check for completed faces adjacent to this edge
    const faces = buildFaces();
    const adjacentFaces = faces.filter(f => {
      const fEdges = getFaceEdges(f);
      return fEdges.some(fe => edgeKey(fe) === key);
    });

    let completedAnyCube = false;

    const newlyCompletedFaces: Face[] = [];
    for (const face of adjacentFaces) {
      const fs = this.faceMap.get(faceKey(face))!;
      if (fs.complete) continue;

      const faceEdgeStates = getFaceEdges(face).map(fe => this.edgeMap.get(edgeKey(fe)));
      if (faceEdgeStates.every(fes => fes?.owner !== null)) {
        fs.complete = true;
        fs.owner = player;
        newlyCompletedFaces.push(face);
        this.emit({ type: 'faceCompleted', face, player });
      }
    }

    // Check for completed cubes
    const cubes = buildCubes();
    for (const cube of cubes) {
      const cs = this.cubeMap.get(cubeKey(cube))!;
      if (cs.complete) continue;

      const cubeFaces = getCubeFaces(cube);
      if (cubeFaces.every(cf => this.faceMap.get(faceKey(cf))?.complete)) {
        cs.complete = true;
        cs.owner = player;
        this.scores[player]++;
        completedAnyCube = true;
        this.emit({ type: 'cubeCompleted', cube, player });
      }
    }

    // Check game over
    const allCubesComplete = Array.from(this.cubeMap.values()).every(cs => cs.complete);
    if (allCubesComplete) {
      this.gameOver = true;
      if (this.scores.A > this.scores.B) this.winner = 'A';
      else if (this.scores.B > this.scores.A) this.winner = 'B';
      else this.winner = null;
      this.emit({ type: 'gameEnded', winner: this.winner, scores: { ...this.scores } });
      return true;
    }

    // Extra turn if cube was completed, else switch
    if (!completedAnyCube) {
      this.currentPlayer = this.currentPlayer === 'A' ? 'B' : 'A';
      this.emit({ type: 'turnChanged', player: this.currentPlayer });
    }

    // Disable undo after player switch (per PRD: undo before next move)
    if (!completedAnyCube) {
      this.canUndo = false;
    }

    return true;
  }

  /**
   * Undo the last move (single step)
   */
  undo(): boolean {
    if (!this.canUndo || this.undoStack.length === 0) return false;
    const snap = this.undoStack.pop()!;
    this.restoreSnapshot(snap);
    this.canUndo = false;
    return true;
  }

  canUndoMove(): boolean {
    return this.canUndo;
  }

  /**
   * Reset the game entirely
   */
  reset() {
    const edges = buildEdges();
    const faces = buildFaces();
    const cubes = buildCubes();

    this.edgeMap.clear();
    this.faceMap.clear();
    this.cubeMap.clear();

    for (const e of edges) this.edgeMap.set(edgeKey(e), { edge: e, owner: null });
    for (const f of faces) this.faceMap.set(faceKey(f), { face: f, owner: null, complete: false });
    for (const c of cubes) this.cubeMap.set(cubeKey(c), { cube: c, owner: null, complete: false });

    this.currentPlayer = Math.random() < 0.5 ? 'A' : 'B';
    this.scores = { A: 0, B: 0 };
    this.gameOver = false;
    this.winner = null;
    this.undoStack = [];
    this.canUndo = false;
  }
}
