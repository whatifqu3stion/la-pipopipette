import { useEffect, useRef, useState, useCallback } from 'react';
import { Game } from './game/Game';
import type { Owner } from './game/types';

// PRD colors — kept for player identity
const PLAYER_COLORS: Record<string, string> = {
  A: '#3a6ea5',
  B: '#c75c5c',
};

// Paper palette
const BG = '#f5f0e8';
const INK = '#2c1a0e';
const INK_MED = 'rgba(44,26,14,0.52)';
const INK_DIM = 'rgba(44,26,14,0.35)';
const INK_FAINT = 'rgba(44,26,14,0.10)';

interface UIState {
  currentPlayer: 'A' | 'B';
  scores: { A: number; B: number };
  gameOver: boolean;
  winner: Owner;
  canUndo: boolean;
}

function PlayerIndicator({ player, score, isActive }: { player: 'A' | 'B'; score: number; isActive: boolean }) {
  const color = PLAYER_COLORS[player];
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 16px',
      borderRadius: 12,
      background: isActive ? `${color}18` : 'rgba(44,26,14,0.04)',
      border: `2px solid ${isActive ? color : INK_FAINT}`,
      transition: 'all 0.2s ease',
      minWidth: 100,
    }}>
      <div style={{
        width: 13,
        height: 13,
        borderRadius: '50%',
        background: color,
        boxShadow: isActive ? `0 0 7px ${color}77` : 'none',
        transition: 'box-shadow 0.2s ease',
      }} />
      <div>
        <div style={{ color: INK_MED, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Player {player}
        </div>
        <div style={{ color: INK, fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{score}</div>
      </div>
    </div>
  );
}

function GameOverBanner({ winner, scores, onReset }: {
  winner: Owner;
  scores: { A: number; B: number };
  onReset: () => void;
}) {
  const color = winner ? PLAYER_COLORS[winner] : INK_MED;
  const text = winner ? `Player ${winner} wins!` : "It's a draw!";

  return (
    <div style={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'rgba(245,240,232,0.97)',
      backdropFilter: 'blur(10px)',
      border: `2px solid ${color}`,
      borderRadius: 20,
      padding: '32px 48px',
      textAlign: 'center',
      zIndex: 100,
      minWidth: 280,
    }}>
      <div style={{ fontSize: 13, color: INK_MED, marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Game Over
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color, marginBottom: 16 }}>{text}</div>
      <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginBottom: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: PLAYER_COLORS.A }}>{scores.A}</div>
          <div style={{ fontSize: 11, color: INK_DIM, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Player A</div>
        </div>
        <div style={{ fontSize: 24, color: INK_FAINT, alignSelf: 'center' }}>—</div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: PLAYER_COLORS.B }}>{scores.B}</div>
          <div style={{ fontSize: 11, color: INK_DIM, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Player B</div>
        </div>
      </div>
      <button
        onClick={onReset}
        style={{
          background: color,
          color: '#fff',
          border: 'none',
          borderRadius: 10,
          padding: '12px 32px',
          fontSize: 16,
          fontWeight: 700,
          cursor: 'pointer',
          width: '100%',
        }}
      >
        Play Again
      </button>
    </div>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [webglError, setWebglError] = useState(false);
  const [ui, setUI] = useState<UIState>({
    currentPlayer: 'A',
    scores: { A: 0, B: 0 },
    gameOver: false,
    winner: null,
    canUndo: false,
  });

  const syncUI = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    setUI({
      currentPlayer: game.getCurrentPlayer(),
      scores: game.getScores(),
      gameOver: game.isGameOver(),
      winner: game.getWinner(),
      canUndo: game.canUndo(),
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let game: Game;
    try {
      game = new Game(canvas);
    } catch (err) {
      console.error('Failed to initialize 3D renderer:', err);
      setWebglError(true);
      return;
    }
    gameRef.current = game;
    game.setStateChangeCallback(syncUI);
    syncUI();

    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, [syncUI]);

  const handleRotateLeft  = () => gameRef.current?.rotateCamera('left');
  const handleRotateRight = () => gameRef.current?.rotateCamera('right');
  const handleUndo  = () => { gameRef.current?.undo();  syncUI(); };
  const handleReset = () => { gameRef.current?.reset(); syncUI(); };

  const btnBase: React.CSSProperties = {
    borderRadius: 10,
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 600,
    transition: 'all 0.15s ease',
    minWidth: 44,
    minHeight: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
  };

  const btnStyle = (active: boolean = true): React.CSSProperties => ({
    ...btnBase,
    background: active ? 'rgba(44,26,14,0.06)' : 'rgba(44,26,14,0.03)',
    color: active ? INK : 'rgba(44,26,14,0.28)',
    border: `1px solid ${active ? 'rgba(44,26,14,0.16)' : INK_FAINT}`,
    cursor: active ? 'pointer' : 'not-allowed',
  });

  const currentColor = PLAYER_COLORS[ui.currentPlayer];

  if (webglError) {
    return (
      <div style={{
        width: '100vw', height: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: BG, color: INK,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        textAlign: 'center', padding: 32,
      }}>
        <div>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>WebGL Unavailable</div>
          <div style={{ fontSize: 14, color: INK_MED }}>
            This game requires WebGL. Please try a different browser or enable hardware acceleration.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      background: BG,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      position: 'relative',
    }}>
      {/* Three.js canvas */}
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />

      {/*
        Paper grain overlay — SVG feTurbulence renders static fractal noise.
        mix-blend-mode: multiply darkens the paper surface where grain lands,
        giving a fiber/tooth feel without any performance cost.
      */}
      <svg
        aria-hidden="true"
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
          zIndex: 1,
          opacity: 0.08,
          mixBlendMode: 'multiply' as React.CSSProperties['mixBlendMode'],
        }}
      >
        <filter id="paper-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.68" numOctaves="4" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#paper-grain)" />
      </svg>

      {/* Top bar */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px',
        background: `linear-gradient(to bottom, rgba(245,240,232,0.94) 0%, transparent 100%)`,
        pointerEvents: 'none',
      }}>
        <div style={{ pointerEvents: 'auto' }}>
          <PlayerIndicator player="A" score={ui.scores.A} isActive={!ui.gameOver && ui.currentPlayer === 'A'} />
        </div>

        {/* Center turn dot */}
        <div style={{ textAlign: 'center', pointerEvents: 'none' }}>
          {!ui.gameOver && (
            <>
              <div style={{ fontSize: 11, color: INK_DIM, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>
                Turn
              </div>
              <div style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: currentColor,
                margin: '0 auto',
                boxShadow: `0 0 8px ${currentColor}88`,
                animation: 'pulse 1.6s ease-in-out infinite',
              }} />
            </>
          )}
          {ui.gameOver && (
            <div style={{ fontSize: 12, color: INK_DIM, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Game Over
            </div>
          )}
        </div>

        <div style={{ pointerEvents: 'auto' }}>
          <PlayerIndicator player="B" score={ui.scores.B} isActive={!ui.gameOver && ui.currentPlayer === 'B'} />
        </div>
      </div>

      {/* Bottom controls */}
      <div style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: '16px 20px 24px',
        background: `linear-gradient(to top, rgba(245,240,232,0.94) 0%, transparent 100%)`,
      }}>
        <button onClick={handleRotateLeft}  style={btnStyle()} title="Rotate left">↺</button>
        <button onClick={handleUndo} disabled={!ui.canUndo} style={btnStyle(ui.canUndo)} title="Undo last move">
          Undo
        </button>

        <div style={{ fontSize: 12, color: INK_DIM, textAlign: 'center', padding: '0 8px', letterSpacing: '0.03em' }}>
          Tap edges to place
        </div>

        <button onClick={handleReset} style={btnStyle()} title="Reset game">Reset</button>
        <button onClick={handleRotateRight} style={btnStyle()} title="Rotate right">↻</button>
      </div>

      {/* Player legend */}
      <div style={{
        position: 'absolute',
        right: 20,
        bottom: 80,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'flex-end',
      }}>
        {(['A', 'B'] as const).map(p => (
          <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: INK_DIM }}>Player {p}</span>
            <div style={{ width: 11, height: 11, borderRadius: 3, background: PLAYER_COLORS[p] }} />
          </div>
        ))}
      </div>

      {ui.gameOver && (
        <GameOverBanner winner={ui.winner} scores={ui.scores} onReset={handleReset} />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.82); }
        }
        button:hover:not(:disabled) {
          background: rgba(44,26,14,0.11) !important;
          border-color: rgba(44,26,14,0.22) !important;
        }
        button:active:not(:disabled) {
          background: rgba(44,26,14,0.05) !important;
        }
      `}</style>
    </div>
  );
}
