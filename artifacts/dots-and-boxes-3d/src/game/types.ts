export type Axis = 'x' | 'y' | 'z';

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface Edge {
  start: Point;
  direction: Axis;
}

export interface Face {
  origin: Point;
  normal: Axis;
}

export interface Cube {
  origin: Point;
}

export type Owner = 'A' | 'B' | null;

export interface EdgeState {
  edge: Edge;
  owner: Owner;
}

export interface FaceState {
  face: Face;
  owner: Owner;
  complete: boolean;
}

export interface CubeState {
  cube: Cube;
  owner: Owner;
  complete: boolean;
}

export interface GameSnapshot {
  edges: EdgeState[];
  faces: FaceState[];
  cubes: CubeState[];
  currentPlayer: 'A' | 'B';
  scores: { A: number; B: number };
  gameOver: boolean;
  winner: Owner;
}

export type GameEvent =
  | { type: 'edgePlaced'; edge: Edge; player: 'A' | 'B' }
  | { type: 'faceCompleted'; face: Face; player: 'A' | 'B' }
  | { type: 'cubeCompleted'; cube: Cube; player: 'A' | 'B' }
  | { type: 'turnChanged'; player: 'A' | 'B' }
  | { type: 'gameEnded'; winner: Owner; scores: { A: number; B: number } };
