import { useEffect, useRef, useState, useCallback } from 'react';
import { Game } from './game/Game';
import type { Owner } from './game/types';

const PLAYER_COLORS: Record<string, string> = {
  A: '#3a6ea5',
  B: '#c75c5c',
};

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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 16px',
        borderRadius: 12,
        background: isActive ? `${color}22` : 'rgba(255,255,255,0.04)',
        border: `2px solid ${isActive ? color : 'rgba(255,255,255,0.08)'}`,
        transition: 'all 0.2s ease',
        minWidth: 100,
      }}
    >
      <div style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: color,
        boxShadow: isActive ? `0 0 8px ${color}88` : 'none',
        transition: 'box-shadow 0.2s ease',
      }} />
      <div>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Player {player}
        </div>
        <div style={{ color: '#fff', fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{score}</div>
      </div>
    </div>
  );
}

function GameOverBanner({ winner, scores, onReset }: { winner: Owner; scores: { A: number; B: number }; onReset: () => void }) {
  const color = winner ? PLAYER_COLORS[winner] : '#888';
  const text = winner ? `Player ${winner} wins!` : "It's a draw!";

  return (
    <div style={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'rgba(15,17,23,0.92)',
      backdropFilter: 'blur(12px)',
      border: `2px solid ${color}`,
      borderRadius: 20,
      padding: '32px 48px',
      textAlign: 'center',
      zIndex: 100,
      minWidth: 280,
    }}>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Game Over
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color, marginBottom: 12 }}>{text}</div>
      <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginBottom: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: PLAYER_COLORS.A }}>{scores.A}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Player A</div>
        </div>
        <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.2)', alignSelf: 'center' }}>—</div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: PLAYER_COLORS.B }}>{scores.B}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Player B</div>
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

  const handleRotateLeft = () => gameRef.current?.rotateCamera('left');
  const handleRotateRight = () => gameRef.current?.rotateCamera('right');
  const handleUndo = () => {
    gameRef.current?.undo();
    syncUI();
  };
  const handleReset = () => {
    gameRef.current?.reset();
    syncUI();
  };

  const btnStyle = (active: boolean = true): React.CSSProperties => ({
    background: active ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
    color: active ? '#fff' : 'rgba(255,255,255,0.25)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 600,
    cursor: active ? 'pointer' : 'not-allowed',
    transition: 'all 0.15s ease',
    minWidth: 44,
    minHeight: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  const currentColor = PLAYER_COLORS[ui.currentPlayer];

  if (webglError) {
    return (
      <div style={{
        width: '100vw', height: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0f1117', color: '#fff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        textAlign: 'center', padding: 32,
      }}>
        <div>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>WebGL Unavailable</div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
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
      background: '#0f1117',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      position: 'relative',
    }}>
      {/* Three.js canvas */}
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />

      {/* Top UI bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px',
        background: 'linear-gradient(to bottom, rgba(15,17,23,0.9) 0%, transparent 100%)',
        pointerEvents: 'none',
      }}>
        {/* Player A */}
        <div style={{ pointerEvents: 'auto' }}>
          <PlayerIndicator player="A" score={ui.scores.A} isActive={!ui.gameOver && ui.currentPlayer === 'A'} />
        </div>

        {/* Center: turn indicator */}
        <div style={{
          textAlign: 'center',
          pointerEvents: 'none',
        }}>
          {!ui.gameOver && (
            <>
              <div style={{
                fontSize: 12,
                color: 'rgba(255,255,255,0.4)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginBottom: 4,
              }}>
                Turn
              </div>
              <div style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: currentColor,
                margin: '0 auto',
                boxShadow: `0 0 12px ${currentColor}`,
                animation: 'pulse 1.5s ease-in-out infinite',
              }} />
            </>
          )}
          {ui.gameOver && (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Game Over
            </div>
          )}
        </div>

        {/* Player B */}
        <div style={{ pointerEvents: 'auto' }}>
          <PlayerIndicator player="B" score={ui.scores.B} isActive={!ui.gameOver && ui.currentPlayer === 'B'} />
        </div>
      </div>

      {/* Bottom control bar */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: '16px 20px 24px',
        background: 'linear-gradient(to top, rgba(15,17,23,0.9) 0%, transparent 100%)',
      }}>
        {/* Rotate left */}
        <button onClick={handleRotateLeft} style={btnStyle()} title="Rotate left">
          ↺
        </button>

        {/* Undo */}
        <button onClick={handleUndo} disabled={!ui.canUndo} style={btnStyle(ui.canUndo)} title="Undo last move">
          Undo
        </button>

        {/* Help text */}
        <div style={{
          fontSize: 12,
          color: 'rgba(255,255,255,0.25)',
          textAlign: 'center',
          padding: '0 8px',
          letterSpacing: '0.03em',
        }}>
          Tap edges to place
        </div>

        {/* Reset */}
        <button onClick={handleReset} style={btnStyle()} title="Reset game">
          Reset
        </button>

        {/* Rotate right */}
        <button onClick={handleRotateRight} style={btnStyle()} title="Rotate right">
          ↻
        </button>
      </div>



      {/* Legend */}
      <div style={{
        position: 'absolute',
        right: 20,
        bottom: 80,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'flex-end',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Player A</span>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: PLAYER_COLORS.A }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Player B</span>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: PLAYER_COLORS.B }} />
        </div>
      </div>

      {/* Game over overlay */}
      {ui.gameOver && (
        <GameOverBanner winner={ui.winner} scores={ui.scores} onReset={handleReset} />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.85); }
        }
        button:hover:not(:disabled) {
          background: rgba(255,255,255,0.14) !important;
          border-color: rgba(255,255,255,0.22) !important;
        }
        button:active:not(:disabled) {
          background: rgba(255,255,255,0.06) !important;
        }
      `}</style>
    </div>
  );
}
