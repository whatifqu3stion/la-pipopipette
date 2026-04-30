import { useEffect, useRef, useState, useCallback } from 'react';
import { Game } from './game/Game';
import type { Owner } from './game/types';
import paperTexture from '@assets/paper-tile_1777512842716.webp';

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
// The visible board surface is built from three CSS background layers on the
// root container (the canvas mounts on top with a transparent clear color,
// so this whole stack reads through as the playing surface):
//
//   1. radial-gradient vignette  — gentle warm-ink darkening at the corners
//      so the eye is drawn to the cube in the center. Center is fully clear
//      out past the cube's silhouette, then ramps softly to the edges. Sized
//      to the viewport (100% 100%, no-repeat) so the wrap is consistent on
//      any aspect ratio.
//   2. paper-tile webp texture   — the visible fiber grain.
//   3. solid BG cream            — fallback / base tone underneath the
//      texture's translucent fibers.
//
// The fog target (BG_COLOR in Renderer.ts) is unchanged: back-facing edges
// still fade toward the same cream that sits between paper and vignette,
// so the existing depth fade behavior reads identically near the cube
// (the cube sits in the center where the vignette is fully transparent).
// ---------------------------------------------------------------------------
const PAPER_VIGNETTE =
  'radial-gradient(ellipse at center, ' +
    'rgba(44,26,14,0) 35%, ' +
    'rgba(44,26,14,0.07) 70%, ' +
    'rgba(44,26,14,0.20) 100%)';
const BOARD_BG_LAYERS: React.CSSProperties = {
  backgroundColor:    BG,
  backgroundImage:    `${PAPER_VIGNETTE}, url(${paperTexture})`,
  backgroundRepeat:   'no-repeat, repeat',
  backgroundSize:     '100% 100%, auto',
  backgroundPosition: 'center center, 0 0',
};

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

  // The board background plate (paper texture + corner vignette) is applied
  // directly to the root container's inline style below — see
  // BOARD_BG_LAYERS at the top of this file. The WebGL canvas mounts above
  // it with a transparent clear color so this stack reads through as the
  // actual board surface.

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
  // BOARD_BG_LAYERS provides a paper-with-vignette plate that's mostly
  // hidden behind the WebGL canvas (which renders an opaque cream background
  // — see Renderer.ts for why: BokehPass post-processing forces alpha=1.0).
  // The plate still shows briefly during canvas init, and is the visible
  // surface in the WebGL-fail fallback. The paper grain SVG and vignette
  // overlay below sit ON TOP of the canvas to layer texture on the cube.
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

      {/* ── Paper grain overlay ── */}
      <svg
        aria-hidden="true"
        style={{
          position:      'absolute',
          inset:         0,
          width:         '100%',
          height:        '100%',
          pointerEvents: 'none',
          zIndex:        1,
          opacity:       0.08,
          mixBlendMode:  'multiply' as React.CSSProperties['mixBlendMode'],
        }}
      >
        <filter id="paper-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.68" numOctaves="4" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#paper-grain)" />
      </svg>

      {/* ── Vignette overlay ──
           The WebGL canvas renders an opaque cream (BG_COLOR) because the
           BokehPass post-process forces alpha=1.0 in its fragment shader,
           which would otherwise make empty regions opaque black. To preserve
           the corner darkening from the original paper-vignette CSS, we layer
           a transparent-center radial gradient on top of the canvas here.
           pointerEvents: 'none' keeps the canvas fully clickable. */}
      <div
        aria-hidden="true"
        style={{
          position:       'absolute',
          inset:          0,
          width:          '100%',
          height:         '100%',
          pointerEvents:  'none',
          zIndex:         2,
          backgroundImage: PAPER_VIGNETTE,
        }}
      />

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
          <button onClick={handleReset}       style={btn()} title="Reset game">Reset</button>
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
