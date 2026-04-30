# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### 3D Dots & Boxes (`artifacts/dots-and-boxes-3d`)
- **Type**: react-vite, preview at `/`
- **Stack**: React + Vite + Three.js (TypeScript)
- **Description**: 3D Dots & Boxes game with gravity rule. Two-player same-device turn-based strategy.
- **Modules**:
  - `src/game/types.ts` — TypeScript types (Edge, Face, Cube, Owner, etc.)
  - `src/game/GameModel.ts` — Pure data model: grid building, adjacency logic, gravity support
  - `src/game/GameState.ts` — Game logic: turn management, scoring, undo, event system
  - `src/game/Renderer.ts` — Three.js scene: points, edges (with hit zones), faces, cubes; postprocessing pipeline with depth-of-field (BokehPass) and a paper-atmosphere ShaderPass (grain + vignette + uneven paper light + warm tint, tunable via `setAtmosphereParams`)
  - `src/game/CameraController.ts` — Turntable camera: cube yaw spins with 90° snap + overshoot; user-controlled elevation (10°–80°) via vertical drag; fixed azimuth
  - `src/game/InputController.ts` — Mouse/touch raycast input handling
  - `src/game/Game.ts` — Orchestrator tying all modules together
  - `src/App.tsx` — React shell with HTML/CSS UI overlay (scores, turn indicator, buttons)
- **PRD**: `attached_assets/3d_dots_boxes_prd-1_1776650032671.md`
- **Spec note**: Gravity rule removed. All unplaced edges are valid moves.
- **Dependencies**: three, @types/three
