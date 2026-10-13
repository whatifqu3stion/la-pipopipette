# La Pipopipette

**A pencil-and-paper game, reimagined in 3D for two people sharing one device.**

[Play the game](https://whatifqu3stion.github.io/la-pipopipette/) · [Explore the game code](artifacts/dots-and-boxes-3d/src/game) · [Deployment guide](docs/github-pages.md)

<p align="center">
  <img src="docs/images/gameplay.png" width="820" alt="La Pipopipette game board: a three-dimensional grid on a paper background, player scores above, character illustration beside the board, and controls below." />
  <br /><sub>The board stays central. Scores, turn feedback, and controls sit around it.</sub>
</p>

## From a bus ride to a hackathon

The idea came from a bus ride and the appeal of a simple game for passing the time. I built La Pipopipette for a hackathon, taking the familiar turn-taking of Dots & Boxes into a small 3D board.

The product question is whether that extra dimension makes a simple shared game more engaging, or adds friction that gets in the way. The current version is a playable exploration of that question. I have not yet tested it with real users.

My focus was the product concept, rules, visual direction, onboarding, and iterative refinement of the experience. Implementation developed through AI-assisted work in Replit. This repository connects those decisions to the shipped interface and code.

## Introducing the game before asking people to play

First-time players see a four-screen introduction: **title → history → two-player format → how to play**. The board appears after the introduction finishes. Later visits go straight to the game using a versioned browser-storage flag.

<table>
  <tr>
    <td align="center"><img src="docs/images/intro-title.png" width="320" alt="Opening title with handwritten La Pipopipette lettering and a Begin button." /><br /><sub>Establish the pencil-and-paper character.</sub></td>
    <td align="center"><img src="docs/images/intro-history.png" width="320" alt="A short introduction to the game's history beside a pen illustration." /><br /><sub>Give the game a little context.</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/intro-players.png" width="320" alt="The introduction explains that two players share one device and take turns." /><br /><sub>Explain the social setup.</sub></td>
    <td align="center"><img src="docs/images/intro-rules.png" width="320" alt="Instructions explain placing lines, claiming cubes, earning an extra turn, and winning by cube count." /><br /><sub>Make the next action and goal explicit.</sub></td>
  </tr>
</table>

The handwritten title sets the tone; instructions and controls use Inter for readability. Progress dots and a Skip button give players a way through the flow. The pen illustration stays mounted between steps, a refinement that removed its transition flicker.

This sequence is a design choice to test. The history screen may add charm, but new players may prefer reaching the rules and board sooner.

## Making a move feel like drawing

<p align="center">
  <img src="docs/images/gameplay-demo.gif" width="680" alt="Animated gameplay capture showing lines drawing into the grid, a face filling, turn characters changing, board rotation, and undo." />
  <br /><sub>Gameplay excerpts from the current local production build. The GIF is silent.</sub>
</p>

The board contains 27 dots, 54 edges, and eight claimable cubes. Each player places one line. Completing a face adds visual feedback; completing a whole cube awards a point and another turn. The player with the most cubes wins.

Several choices support that interaction:

- **A clear grid becomes an ink drawing.** Neutral edges are straight. Placed edges draw in with a sketch-like stroke and a moving highlight, followed by the face fill. That sequence makes the relationship between an action and its result visible.
- **The line can stay thin while the target is generous.** Invisible hit geometry surrounds each edge. Raycasting selects an available edge without requiring a click precisely on the visible stroke.
- **Exploration and placement have separate gestures.** Taps place lines; drags rotate or tilt the board after a movement threshold. Scroll and pinch control zoom. Rotation buttons provide quarter turns, while a dragged view can rest between them to expose awkward edges.
- **Feedback extends beyond the board.** Player colors connect lines, scores, and the turn indicator. An animated frog or rabbit appears for the active player on wider screens. Characters disappear on narrower layouts to preserve room for the game.
- **Mistakes are recoverable.** One-step undo restores the previous board, score, and player. It supports a quick correction without adding a confirmation dialog to every move.

The paper texture, restrained colors, drawing sounds, and optional music carry the original game's tactile feel into the interface. Whether players find that feedback satisfying is still a playtesting question.

## What changed during development

These are implementation iterations recorded in the repository, not findings from a user study.

| Issue or decision | Refinement | Product implication |
| --- | --- | --- |
| An early brief included a gravity restriction. | The shipped game accepts any unplaced edge. | One fewer rule to explain; the effect on strategy still needs evaluation. |
| Decorative type was also used for onboarding text. | Handwriting was reserved for titles and Inter used for instructions. | Preserve the visual identity while making essential text easier to read. |
| A face could fill before its final line finished drawing. | Fill animations were deferred until the edge stroke completed. | Make the action and its consequence easier to follow. |
| Character panels competed with the board. | Placement, scale, blending, and the responsive breakpoint were revised. | Give the game personality while protecting the play area. |
| Some mobile rendering configurations produced a blank board. | A simpler render target skips multisampling and the depth-texture grain pass on likely mobile devices. | Accept a visual tradeoff so the board can render. |
| The board did not consistently fit changing viewport sizes. | Resize observation moved to the canvas parent; camera fit and zoom limits adapt to its dimensions. | Keep the board reachable as the available space changes. |
| A third-party widget could serve malformed JavaScript. | Its badge and heartbeat were implemented locally; opaque external errors are filtered from the development overlay. | Reduce reliance on an external script while retaining diagnostics for app errors. |

Examples in the history: [onboarding readability](https://github.com/whatifqu3stion/la-pipopipette/commit/35f8b899b1dc533c18c0cb42e2537a11d38de86e), [mobile rendering](https://github.com/whatifqu3stion/la-pipopipette/commit/5b994b21026b8e5d9ebc5a3f5495d31a60b70675), and [viewport resizing](https://github.com/whatifqu3stion/la-pipopipette/commit/6e7fb5784006581006ca9c1700253dfd1de52889).

## Technical structure

**React · TypeScript · Three.js · Vite · pnpm · GitHub Actions / Pages**

The game runs in the browser. It needs no account, API server, or database. The wider Replit workspace contains backend scaffolding, but the game does not depend on it.

| Layer | Responsibility | Source |
| --- | --- | --- |
| Model and rules | Generate the grid; validate moves; resolve faces, cube ownership, scores, turns, and undo snapshots. | [GameModel.ts](artifacts/dots-and-boxes-3d/src/game/GameModel.ts), [GameState.ts](artifacts/dots-and-boxes-3d/src/game/GameState.ts) |
| Interaction | Translate mouse/touch input, select edges, and manage rotation, tilt, zoom, and viewport fitting. | [InputController.ts](artifacts/dots-and-boxes-3d/src/game/InputController.ts), [CameraController.ts](artifacts/dots-and-boxes-3d/src/game/CameraController.ts) |
| Rendering | Draw the board, ink geometry, fills, lighting, grain, depth of field, and animations. | [Renderer.ts](artifacts/dots-and-boxes-3d/src/game/Renderer.ts) |
| Coordination and interface | Connect rule events to rendering and audio; show scores, onboarding, characters, music controls, and the end state. | [Game.ts](artifacts/dots-and-boxes-3d/src/game/Game.ts), [App.tsx](artifacts/dots-and-boxes-3d/src/App.tsx) |

Rules are separate from rendering, so visual experiments do not need to redefine scoring or turns. The game model uses coordinates and adjacency rather than treating the scene's appearance as the source of truth. Events connect the rules to the experience, and snapshots make undo a state restoration rather than a visual approximation.

Deployment builds only the game package. Pull requests run its TypeScript check and production build; pushes to `la-pipopipette` publish the generated files to GitHub Pages. Images, sounds, and videos resolve beneath the site's repository path.

The TypeScript check and production build passed for deployment. The README captures also exercise the intro, edge placement, rotation, and undo in a desktop Chromium build. These are functional checks; real-user evaluation remains the next step.

## Next: prove the idea with real players

The next step is a small round of observed playtests with pairs, comparing the original 2D game with this version. Alternate which version people play first, explain each consistently, and separate confusion with the rules from difficulty using the interface. A first round would guide refinement, not establish a broad engagement claim.

| Question | What I would observe or ask | What it could change |
| --- | --- | --- |
| Is 3D more or less engaging than the original? | Preference after playing both, reasons for that preference, and whether people choose another round when given the opportunity. | The core direction, board complexity, or pacing. |
| Can newcomers start without coaching? | What they think earns a point, their first move, and when they ask for help. | Intro length, rule wording, or an interactive example. |
| What is fun or satisfying? | Ask players to identify enjoyable moments: placing a line, filling a face, claiming a cube, or planning a move. | Feedback timing, sound, and emphasis. |
| What is unclear or frustrating? | Intended versus selected edges, use of undo, camera adjustments, and confusion between face completion and scoring. | Hit targets, visibility, camera behavior, and score feedback. |
| Does the experience hold up on a phone? | Readability, tap accuracy, board fit, and whether the controls interrupt play. | Layout, rendering choices, and touch interaction. |

I would prioritize recurring blockers to understanding and control, then test the revisions again. Keyboard gameplay, reduced-motion options, and stronger cues beyond player color are also areas for further development.

## Run locally

Use Node.js 24 and pnpm 10. From the repository root:

```sh
pnpm install --frozen-lockfile --filter @workspace/dots-and-boxes-3d...
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/dots-and-boxes-3d run dev
```

Open `http://localhost:5173/`. The browser needs WebGL. Fonts and music use external services; sound playback depends on browser media policies.

```sh
pnpm --filter @workspace/dots-and-boxes-3d run typecheck
PORT=5173 BASE_PATH=/la-pipopipette/ pnpm --filter @workspace/dots-and-boxes-3d run build
```

See the [Pages guide](docs/github-pages.md) for production preview and deployment. The [original product brief](attached_assets/3d_dots_boxes_prd-1_1776650032671.md) is retained as an early design artifact; its gravity rule and some visual requirements were superseded during development.
