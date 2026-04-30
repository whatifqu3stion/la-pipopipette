import { useEffect, useRef, useState, useCallback } from 'react';
import { Game } from './game/Game';
import type { Owner } from './game/types';
import paperCrumpleOverlay from '@assets/white-paper-texture_1777522901345.jpg';

// Player colors — matched to the in-game palette in Renderer.ts so the UI
// dots, score panels, and turn pulse all read as the same hue as the lines.
const PLAYER_COLORS: Record<string, string> = {
  A: '#2a82e0',
  B: '#e33334',
};

// Paper palette
const BG      = '#f5f0e8';
const INK     = '#2c1a0e';
const INK_MED = 'rgba(44,26,14,0.52)';
const INK_DIM = 'rgba(44,26,14,0.35)';
const INK_FAINT = 'rgba(44,26,14,0.10)';

// ---------------------------------------------------------------------------
// Board background plate
//
// The visible board surface is now just a flat cream base color on the root
// container. The canvas mounts on top with a transparent clear color, and
// the crumpled-paper photo overlay (rendered separately further down in the
// JSX) supplies all the visible paper character — creases, fold shadows,
// and subtle warmth — via `mix-blend-mode: multiply`.
//
// Previous iterations of this background also stacked a small repeating
// fiber-grain webp tile under the crumple overlay and a corner-darkening
// vignette over it. Both have been removed: the vignette caused yellow
// edge tinting on wide screens, and the fiber-grain tile was redundant
// once the crumple overlay was already supplying texture. A slight warm
// tint at the wide-screen edges remains as a known property of the kept
// crumple overlay (cover-sized photo whose warmer regions land at the
// edges in landscape).
//
// The fog target (BG_COLOR in Renderer.ts) is unchanged: back-facing edges
// still fade toward the same cream, so the existing depth fade reads the
// same near the cube.
// ---------------------------------------------------------------------------
const BOARD_BG_LAYERS: React.CSSProperties = {
  backgroundColor: BG,
};

// ---------------------------------------------------------------------------
// Procedural grain overlay
//
// A barely-there risograph-style grain that sits OVER the final composite
// (canvas + crumple overlay) but UNDER the UI controls, giving the whole
// view a touch of light variation and paper tooth without distorting the
// gameplay objects themselves.
//
// Implementation: an inline SVG `feTurbulence` filter rasterised once by
// the browser and tiled across the viewport. No external image asset, no
// shader pass, no library — the simplest possible thing that works. Cost
// is essentially a single small tiled image, GPU-composited.
//
// Layering: zIndex 3 (above crumple overlay at zIndex 2, below UI at 10+).
// `mix-blend-mode: soft-light` keeps it as a light/dark modulation rather
// than a flat tint, so colors below stay correct.
// ---------------------------------------------------------------------------
const GRAIN_ENABLED = true; // single switch to disable the effect entirely

// Tiled procedural noise. baseFrequency tuned for a fine paper-tooth grain
// (higher = finer); the alpha row in feColorMatrix sets per-pixel intensity
// before we layer-opacity it down to "barely there".
const GRAIN_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>" +
    "<filter id='n'>" +
      "<feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/>" +
      "<feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 0'/>" +
    "</filter>" +
    "<rect width='100%' height='100%' filter='url(%23n)'/>" +
  "</svg>";
const GRAIN_URL = `url("data:image/svg+xml;utf8,${encodeURIComponent(GRAIN_SVG)}")`;

// Soft perf guard: on devices reporting few logical cores (typical of
// low-end phones), drop opacity to ~half. The actual GPU cost of a single
// tiled image is negligible, but per the request we keep a knob.
const IS_LOW_END_DEVICE =
  typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4;
const GRAIN_OPACITY = GRAIN_ENABLED ? (IS_LOW_END_DEVICE ? 0.045 : 0.085) : 0;

// Safe-area-aware padding helpers (CSS calc strings)
const safeTop    = 'calc(env(safe-area-inset-top, 0px) + 12px)';
const safeBottom = 'calc(env(safe-area-inset-bottom, 0px) + 10px)';
const safeLeft   = 'calc(env(safe-area-inset-left, 0px) + 12px)';
const safeRight  = 'calc(env(safe-area-inset-right, 0px) + 12px)';

interface UIState {
  currentPlayer: 'A' | 'B';
  scores: { A: number; B: number };
  gameOver: boolean;
  winner: Owner;
  canUndo: boolean;
}

// ---------------------------------------------------------------------------
// PlayerIndicator
// ---------------------------------------------------------------------------
function PlayerIndicator({
  player, score, isActive,
}: { player: 'A' | 'B'; score: number; isActive: boolean }) {
  const color = PLAYER_COLORS[player];
  return (
    <div style={{
      display:        'flex',
      alignItems:     'center',
      gap:            8,
      padding:        '7px 12px',
      borderRadius:   12,
      background:     isActive ? `${color}18` : 'rgba(44,26,14,0.04)',
      border:         `2px solid ${isActive ? color : INK_FAINT}`,
      transition:     'border-color 0.2s, background 0.2s',
      minHeight:      44,
      flexShrink:     0,
    }}>
      {/* Colour dot */}
      <div style={{
        width:      12,
        height:     12,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        boxShadow:  isActive ? `0 0 6px ${color}88` : 'none',
        transition: 'box-shadow 0.2s',
      }} />
      <div>
        <div style={{
          color:         INK_MED,
          fontSize:      10,
          fontWeight:    600,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          lineHeight:    1,
          marginBottom:  2,
        }}>
          P{player}
        </div>
        <div style={{
          color:      INK,
          fontSize:   22,
          fontWeight: 700,
          lineHeight: 1,
        }}>
          {score}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Game-over banner
// ---------------------------------------------------------------------------
function GameOverBanner({
  winner, scores, onReset,
}: { winner: Owner; scores: { A: number; B: number }; onReset: () => void }) {
  const color = winner ? PLAYER_COLORS[winner] : INK_MED;
  const text  = winner ? `Player ${winner} wins!` : "It's a draw!";

  return (
    <div style={{
      position:        'absolute',
      inset:           0,
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      zIndex:          100,
      padding:         '0 24px',
    }}>
      <div style={{
        width:            '100%',
        maxWidth:         340,
        background:       'rgba(245,240,232,0.97)',
        backdropFilter:   'blur(10px)',
        border:           `2px solid ${color}`,
        borderRadius:     20,
        padding:          '28px 28px 24px',
        textAlign:        'center',
      }}>
        <div style={{
          fontSize:      12,
          color:         INK_MED,
          marginBottom:  6,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}>
          Game Over
        </div>

        <div style={{
          fontSize:     28,
          fontWeight:   800,
          color,
          marginBottom: 18,
          lineHeight:   1.15,
        }}>
          {text}
        </div>

        {/* Score row */}
        <div style={{
          display:         'flex',
          gap:             20,
          justifyContent:  'center',
          marginBottom:    22,
        }}>
          {(['A', 'B'] as const).map(p => (
            <div key={p} style={{ textAlign: 'center' }}>
              <div style={{
                fontSize:   26,
                fontWeight: 700,
                color:      PLAYER_COLORS[p],
                lineHeight: 1,
              }}>
                {scores[p]}
              </div>
              <div style={{
                fontSize:      10,
                color:         INK_DIM,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginTop:     3,
              }}>
                Player {p}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onReset}
          style={{
            background:   color,
            color:        '#fff',
            border:       'none',
            borderRadius: 12,
            padding:      '14px 0',
            fontSize:     16,
            fontWeight:   700,
            cursor:       'pointer',
            width:        '100%',
            minHeight:    48,
          }}
        >
          Play Again
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef   = useRef<Game | null>(null);
  const [webglError, setWebglError] = useState(false);
  const [ui, setUI] = useState<UIState>({
    currentPlayer: 'A',
    scores:        { A: 0, B: 0 },
    gameOver:      false,
    winner:        null,
    canUndo:       false,
  });

  const syncUI = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    setUI({
      currentPlayer: game.getCurrentPlayer(),
      scores:        game.getScores(),
      gameOver:      game.isGameOver(),
      winner:        game.getWinner(),
      canUndo:       game.canUndo(),
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let game: Game;
    try {
      game = new Game(canvas);
    } catch (err) {
      console.error('WebGL init failed:', err);
      setWebglError(true);
      return;
    }
    gameRef.current = game;
    game.setStateChangeCallback(syncUI);
    syncUI();
    return () => { game.dispose(); gameRef.current = null; };
  }, [syncUI]);

  // The board background plate (a flat cream base color) is applied
  // directly to the root container's inline style below — see
  // BOARD_BG_LAYERS at the top of this file. The WebGL canvas mounts above
  // it with a transparent clear color, and the crumpled-paper photo
  // overlay is rendered above the canvas to supply visible paper detail.

  const handleRotateLeft  = () => gameRef.current?.rotateCamera('left');
  const handleRotateRight = () => gameRef.current?.rotateCamera('right');
  const handleUndo        = () => { gameRef.current?.undo();  syncUI(); };
  const handleReset       = () => { gameRef.current?.reset(); syncUI(); };

  const currentColor = PLAYER_COLORS[ui.currentPlayer];

  // Shared button style factory
  const btn = (enabled = true): React.CSSProperties => ({
    flex:            1,
    minWidth:        0,
    minHeight:       48,
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    borderRadius:    12,
    border:          `1px solid ${enabled ? 'rgba(44,26,14,0.16)' : INK_FAINT}`,
    background:      enabled ? 'rgba(44,26,14,0.06)' : 'rgba(44,26,14,0.02)',
    color:           enabled ? INK : 'rgba(44,26,14,0.26)',
    fontSize:        15,
    fontWeight:      600,
    fontFamily:      'inherit',
    cursor:          enabled ? 'pointer' : 'not-allowed',
    transition:      'background 0.12s, border-color 0.12s',
    userSelect:      'none',
    WebkitUserSelect:'none',
  });

  // -------------------------------------------------------------------------
  // WebGL error screen
  // -------------------------------------------------------------------------
  if (webglError) {
    return (
      <div style={{
        position:       'fixed',
        inset:          0,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        ...BOARD_BG_LAYERS,
        color:          INK,
        fontFamily:     '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        textAlign:      'center',
        padding:        '0 32px',
      }}>
        <div>
          <div style={{ fontSize: 36, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            WebGL unavailable
          </div>
          <div style={{ fontSize: 14, color: INK_MED, lineHeight: 1.5 }}>
            This game requires WebGL. Please try a different browser or enable
            hardware acceleration.
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Main layout
  //
  // Root is position:fixed / inset:0 — avoids the iOS 100vh bug where the
  // browser toolbar eats into the viewport.
  //
  // BOARD_BG_LAYERS provides a flat cream base that's mostly hidden behind
  // the WebGL canvas (which renders an opaque cream background — see
  // Renderer.ts for why: BokehPass post-processing forces alpha=1.0). The
  // plate still shows briefly during canvas init, and is the visible
  // surface in the WebGL-fail fallback. The crumpled-paper overlay below
  // sits ON TOP of the canvas to layer crease detail across everything.
  // -------------------------------------------------------------------------
  return (
    <div style={{
      position:   'fixed',
      inset:      0,
      overflow:   'hidden',
      ...BOARD_BG_LAYERS,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>

      {/* ── Canvas (fills entire root) ── */}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />

      {/* ── Crumpled-paper overlay ──
           A photo of crumpled paper layered over the entire board (canvas)
           using `mix-blend-mode: multiply`. White areas of the photo (most
           of it) leave the underlying pixels alone; the gray crease shadows
           add subtle dark detail that reads as folded paper catching light.
           Sized 'cover' so the crease pattern fills the viewport without
           seams. Sits below the UI (zIndex 10+) so buttons and labels
           remain crisp. pointer-events: none keeps the canvas fully
           interactive. */}
      <div
        aria-hidden="true"
        style={{
          position:           'absolute',
          inset:              0,
          width:              '100%',
          height:             '100%',
          pointerEvents:      'none',
          zIndex:             2,
          backgroundImage:    `url(${paperCrumpleOverlay})`,
          backgroundSize:     'cover',
          backgroundPosition: 'center center',
          backgroundRepeat:   'no-repeat',
          opacity:            0.20,
          mixBlendMode:       'multiply' as React.CSSProperties['mixBlendMode'],
        }}
      />

      {/* ── Procedural grain overlay ──
           Inline SVG turbulence pattern tiled across the viewport. Sits
           above the crumple overlay (zIndex 2) and below the UI (zIndex
           10+) so gameplay stays crisp. See the GRAIN_* constants above
           for the toggle / opacity tuning. */}
      {GRAIN_OPACITY > 0 && (
        <div
          aria-hidden="true"
          style={{
            position:         'absolute',
            inset:            0,
            pointerEvents:    'none',
            zIndex:           3,
            backgroundImage:  GRAIN_URL,
            backgroundRepeat: 'repeat',
            backgroundSize:   '240px 240px',
            opacity:          GRAIN_OPACITY,
            mixBlendMode:     'soft-light' as React.CSSProperties['mixBlendMode'],
          }}
        />
      )}

      {/* ── TOP BAR ── */}
      <div style={{
        position:   'absolute',
        top:        0,
        left:       0,
        right:      0,
        zIndex:     10,
        display:    'flex',
        alignItems: 'center',
        gap:        8,
        // Safe-area-aware padding
        paddingTop:    safeTop,
        paddingLeft:   safeLeft,
        paddingRight:  safeRight,
        paddingBottom: '12px',
        background:    'linear-gradient(to bottom, rgba(245,240,232,0.95) 0%, transparent 100%)',
      }}>
        {/* Player A */}
        <PlayerIndicator
          player="A"
          score={ui.scores.A}
          isActive={!ui.gameOver && ui.currentPlayer === 'A'}
        />

        {/* Centre turn / game-over indicator */}
        <div style={{
          flex:           1,
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            5,
          pointerEvents:  'none',
        }}>
          {!ui.gameOver ? (
            <>
              <div style={{
                fontSize:      10,
                color:         INK_DIM,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}>
                Turn
              </div>
              <div style={{
                width:        9,
                height:       9,
                borderRadius: '50%',
                background:   currentColor,
                boxShadow:    `0 0 8px ${currentColor}99`,
                animation:    'pulse 1.6s ease-in-out infinite',
              }} />
            </>
          ) : (
            <div style={{
              fontSize:      11,
              color:         INK_DIM,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}>
              Game Over
            </div>
          )}
        </div>

        {/* Player B */}
        <PlayerIndicator
          player="B"
          score={ui.scores.B}
          isActive={!ui.gameOver && ui.currentPlayer === 'B'}
        />
      </div>

      {/* ── BOTTOM BAR ── */}
      <div style={{
        position:       'absolute',
        bottom:         0,
        left:           0,
        right:          0,
        zIndex:         10,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'stretch',
        gap:            6,
        paddingTop:     '8px',
        paddingLeft:    safeLeft,
        paddingRight:   safeRight,
        paddingBottom:  safeBottom,
        background:     'linear-gradient(to top, rgba(245,240,232,0.96) 0%, transparent 100%)',
      }}>

        {/* Hint */}
        <div style={{
          textAlign:     'center',
          fontSize:      11,
          color:         INK_DIM,
          letterSpacing: '0.04em',
          lineHeight:    1,
          pointerEvents: 'none',
        }}>
          Tap an edge to place
        </div>

        {/* Button row — 4 equal flex buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleRotateLeft}  style={btn()} title="Rotate left">↺</button>
          <button
            onClick={handleUndo}
            disabled={!ui.canUndo}
            style={btn(ui.canUndo)}
            title="Undo last move"
          >
            Undo
          </button>
          <button onClick={handleReset}       style={btn()} title="Restart game">Restart</button>
          <button onClick={handleRotateRight} style={btn()} title="Rotate right">↻</button>
        </div>
      </div>

      {/* ── Game-over overlay ── */}
      {ui.gameOver && (
        <GameOverBanner winner={ui.winner} scores={ui.scores} onReset={handleReset} />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1;    transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(0.8); }
        }
        button:hover:not(:disabled) {
          background:   rgba(44,26,14,0.11) !important;
          border-color: rgba(44,26,14,0.22) !important;
        }
        button:active:not(:disabled) {
          background: rgba(44,26,14,0.05) !important;
        }
      `}</style>
    </div>
  );
}
