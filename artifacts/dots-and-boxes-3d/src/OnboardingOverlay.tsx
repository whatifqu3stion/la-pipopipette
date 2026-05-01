import React, { useEffect, useState, useRef } from 'react';

// Onboarding overlay shown the first time a player visits the game.
// Sequence: title → "A bit of history" → "What it is" → "How to play"
// → onComplete() (which fades the overlay out and lets the cube reveal).
//
// Typography: Reenie Beanie is reserved for the two title lines on the
// splash screen ("La Pipopipette" / "3D Dots & Boxes") to give them a
// handwritten, pencil-and-paper character. Everything else — eyebrows,
// body copy, buttons — uses Inter for clean modern readability.

const FONT          = '"Reenie Beanie", cursive';
const MODERN_FONT   = 'Inter, system-ui, sans-serif';
const INK           = '#2c1a0e';
const INK_MED       = 'rgba(44,26,14,0.62)';
const INK_DIM       = 'rgba(44,26,14,0.40)';
const BG            = '#f5f0e8';
const ACCENT_A      = '#2a82e0';
const ACCENT_B      = '#e33334';

// Title auto-advance: how long the title screen lingers before moving on.
// Extended so the title has time to settle and the player can read it.
const TITLE_HANG_MS = 5800;

type Step = 'title' | 'history' | 'what' | 'how';

interface OnboardingOverlayProps {
  onComplete: () => void;
}

// ----------------------------------------------------------------------------
// Section content
// ----------------------------------------------------------------------------
const SECTIONS: Record<Exclude<Step, 'title'>, {
  eyebrow: string;
  body:    React.ReactNode;
  cta:     string;
}> = {
  history: {
    eyebrow: 'A bit of history',
    body: (
      <>
        This take on a classic pencil-and-paper game dates back to the 1800s.
        It was popularized by French mathematician{' '}
        <span style={{ color: INK, fontWeight: 600 }}>Édouard Lucas</span>,
        who called it{' '}
        <span style={{ fontStyle: 'italic' }}>"La Pipopipette"</span>,
        meaning <span style={{ fontStyle: 'italic' }}>"the game of little lines."</span>
      </>
    ),
    cta: 'Continue',
  },
  what: {
    eyebrow: 'What it is',
    body: (
      <>
        2 players. One device. Pass it back and forth and try to outscore
        each other.
      </>
    ),
    cta: 'Continue',
  },
  how: {
    eyebrow: 'How to play',
    body: (
      <ul style={{
        listStyle:     'none',
        padding:       0,
        margin:        '4px 0 0',
        textAlign:     'left',
        display:       'flex',
        flexDirection: 'column',
        gap:           14,
      }}>
        {[
          'Draw one line between two dots.',
          'Take turns passing the device.',
          'Complete a cube to claim it.',
          'Completing a cube gives you another turn.',
          'Most cubes wins.',
          "The last line of a cube is powerful — make sure you're the one taking it.",
        ].map((line, i) => (
          <li key={i} style={{
            display:    'flex',
            alignItems: 'baseline',
            gap:        12,
            lineHeight: 1.35,
          }}>
            <span style={{
              flexShrink:  0,
              width:       8,
              height:      8,
              borderRadius:'50%',
              background:  i % 2 === 0 ? ACCENT_A : ACCENT_B,
              transform:   'translateY(-1px)',
            }}/>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    ),
    cta: 'Start playing',
  },
};

// Order of section steps after title.
const STEP_ORDER: Step[] = ['title', 'history', 'what', 'how'];

// ----------------------------------------------------------------------------
// OnboardingOverlay — top-level component
// ----------------------------------------------------------------------------
export function OnboardingOverlay({ onComplete }: OnboardingOverlayProps) {
  const [step, setStep]       = useState<Step>('title');
  const [closing, setClosing] = useState(false);
  // Each step gets a unique key so React unmounts/remounts the inner panel,
  // which restarts CSS keyframes for a clean cross-fade.
  const stepKey = useRef(0);

  const goNext = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) {
      stepKey.current += 1;
      setStep(STEP_ORDER[idx + 1]);
    } else {
      finish();
    }
  };

  const finish = () => {
    if (closing) return;
    setClosing(true);
    // Match the overlay fade-out duration (.obOverlayOut keyframes) so
    // onComplete fires exactly as the overlay disappears, allowing the
    // cube to start its reveal beneath.
    window.setTimeout(onComplete, 480);
  };

  // Auto-advance from the title screen after TITLE_HANG_MS so users who
  // don't click still proceed. They can also click "Continue" to skip ahead.
  useEffect(() => {
    if (step !== 'title') return;
    const t = window.setTimeout(() => {
      if (!closing) {
        stepKey.current += 1;
        setStep('history');
      }
    }, TITLE_HANG_MS);
    return () => window.clearTimeout(t);
  }, [step, closing]);

  return (
    <>
      {/* Inline keyframes — colocated so the overlay is self-contained. */}
      <style>{`
        @keyframes obOverlayIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes obOverlayOut { from { opacity: 1; } to { opacity: 0; } }

        @keyframes obTitleIn {
          0%   { opacity: 0; transform: translateY(12px) scale(0.97); }
          100% { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        @keyframes obSubtitleIn {
          0%   { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0);   }
        }

        @keyframes obPanelIn {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0);   }
        }
        @keyframes obButtonIn {
          0%   { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0);   }
        }

        .ob-cta { transition: background 0.15s, border-color 0.15s, transform 0.1s; }
        .ob-cta:hover  { background: rgba(44,26,14,0.10); }
        .ob-cta:active { transform: translateY(1px); }

        .ob-skip { transition: color 0.15s; }
        .ob-skip:hover { color: ${INK}; }
      `}</style>

      <div
        style={{
          position:       'fixed',
          inset:          0,
          background:     BG,
          zIndex:         50,
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          padding:        '24px 24px',
          paddingTop:     'calc(env(safe-area-inset-top, 0px) + 24px)',
          paddingBottom:  'calc(env(safe-area-inset-bottom, 0px) + 24px)',
          fontFamily:     MODERN_FONT,
          color:          INK,
          animation:      closing
            ? 'obOverlayOut 460ms ease-in forwards'
            : 'obOverlayIn 360ms ease-out forwards',
        }}
      >
        {/* Skip link */}
        {step !== 'title' && !closing && (
          <button
            onClick={finish}
            className="ob-skip"
            style={{
              position:   'absolute',
              top:        'calc(env(safe-area-inset-top, 0px) + 16px)',
              right:      'calc(env(safe-area-inset-right, 0px) + 16px)',
              background: 'transparent',
              border:     'none',
              color:      INK_DIM,
              fontSize:   13,
              fontWeight: 500,
              cursor:     'pointer',
              padding:    '6px 8px',
            }}
          >
            Skip
          </button>
        )}

        {step === 'title' ? (
          <div
            key={stepKey.current}
            style={{
              width:     '100%',
              maxWidth:  640,
              textAlign: 'center',
            }}
          >
            {/* Main title — Reenie Beanie */}
            <div style={{
              fontFamily: FONT,
              fontSize:   'clamp(72px, 16vw, 110px)',
              lineHeight: 1.05,
              color:      INK,
              opacity:    0,
              animation:  'obTitleIn 900ms cubic-bezier(.2,.7,.2,1) 200ms forwards',
            }}>
              La Pipopipette
            </div>

            {/* Sub-label — Reenie Beanie */}
            <div style={{
              fontFamily:    FONT,
              marginTop:     14,
              fontSize:      28,
              color:         INK_DIM,
              opacity:       0,
              animation:     'obSubtitleIn 700ms ease-out 900ms forwards',
            }}>
              3D Dots &amp; Boxes
            </div>

            <button
              onClick={goNext}
              className="ob-cta"
              style={{
                marginTop:    48,
                padding:      '10px 32px',
                borderRadius: 12,
                border:       `1px solid rgba(44,26,14,0.18)`,
                background:   'rgba(44,26,14,0.06)',
                color:        INK,
                fontSize:     15,
                fontWeight:   500,
                letterSpacing: '0.03em',
                cursor:       'pointer',
                opacity:      0,
                animation:    'obButtonIn 500ms ease-out 1400ms forwards',
              }}
            >
              Begin
            </button>
          </div>
        ) : (
          <div
            key={stepKey.current}
            style={{
              width:     '100%',
              maxWidth:  520,
              textAlign: 'center',
              animation: 'obPanelIn 420ms cubic-bezier(.2,.7,.2,1) forwards',
            }}
          >
            {/* Eyebrow */}
            <div style={{
              fontSize:      11,
              fontWeight:    600,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color:         INK_DIM,
              marginBottom:  14,
            }}>
              {SECTIONS[step].eyebrow}
            </div>

            {/* Body */}
            <div style={{
              fontSize:   step === 'how' ? 15 : 17,
              lineHeight: 1.65,
              color:      INK_MED,
            }}>
              {SECTIONS[step].body}
            </div>

            <button
              onClick={goNext}
              className="ob-cta"
              style={{
                marginTop:     36,
                padding:       '10px 32px',
                borderRadius:  12,
                border:        `1px solid rgba(44,26,14,0.18)`,
                background:    'rgba(44,26,14,0.06)',
                color:         INK,
                fontSize:      15,
                fontWeight:    500,
                letterSpacing: '0.03em',
                cursor:        'pointer',
                opacity:       0,
                animation:     'obButtonIn 420ms ease-out 220ms forwards',
              }}
            >
              {SECTIONS[step].cta}
            </button>

            {/* Step indicator dots */}
            <div style={{
              marginTop:      24,
              display:        'flex',
              justifyContent: 'center',
              gap:            8,
            }}>
              {(['history', 'what', 'how'] as const).map(s => (
                <div
                  key={s}
                  style={{
                    width:        6,
                    height:       6,
                    borderRadius: '50%',
                    background:   s === step ? INK : 'rgba(44,26,14,0.18)',
                    transition:   'background 0.2s',
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
