import React, { useEffect, useState, useRef } from 'react';

// Onboarding overlay shown the first time a player visits the game.
// Sequence: title → "A bit of history" → "What it is" → "How to play"
// → onComplete() (which fades the overlay out and lets the cube reveal).
//
// All steps share a common cream/ink palette matching the rest of the
// app so the overlay reads as part of the same world rather than a
// separate page. The title uses Inter (already loaded by index.html)
// for the geometric look the user requested.

const INK         = '#2c1a0e';
const INK_MED     = 'rgba(44,26,14,0.62)';
const INK_DIM     = 'rgba(44,26,14,0.40)';
const BG          = '#f5f0e8';
const ACCENT_A    = '#2a82e0';
const ACCENT_B    = '#e33334';

type Step = 'title' | 'history' | 'what' | 'how';

interface OnboardingOverlayProps {
  onComplete: () => void;
}

// ----------------------------------------------------------------------------
// Title — "La Pipopipette" rendered with a network-of-dots-and-lines motif
// ----------------------------------------------------------------------------
//
// The title text itself stays a clean Inter wordmark (fully readable). Around
// it we draw a thin geometric network: a rectangular frame with a midline
// crossbar, connecting four corner nodes and four midpoint nodes. This
// echoes the dot-and-edge vocabulary of the cube without trying to
// deconstruct the letterforms (which is hard to do well at this size and
// usually hurts legibility).
//
// Animation order on mount:
//   0–500ms   nodes fade/scale in
//   300–900ms lines draw in (stroke-dashoffset → 0)
//   700ms+    title text fades + lifts in
// ----------------------------------------------------------------------------
function TitleNetwork() {
  // viewBox is wide so the title has room. The SVG scales to fit its
  // container width (CSS width: 100%, max-width via parent).
  const W = 560;
  const H = 180;
  const pad = 24;             // distance from frame to viewBox edge
  const x0 = pad, x1 = W - pad;
  const y0 = pad, y1 = H - pad;
  const xm = W / 2, ym = H / 2;

  // Nodes: 4 corners + 4 midpoints. Slightly larger at corners to read as
  // "endpoint" nodes vs the midpoint waypoints.
  const nodes = [
    { x: x0, y: y0, r: 4.5, delay: 0    },
    { x: x1, y: y0, r: 4.5, delay: 90   },
    { x: x1, y: y1, r: 4.5, delay: 180  },
    { x: x0, y: y1, r: 4.5, delay: 270  },
    { x: xm, y: y0, r: 3.5, delay: 360  },
    { x: x1, y: ym, r: 3.5, delay: 420  },
    { x: xm, y: y1, r: 3.5, delay: 480  },
    { x: x0, y: ym, r: 3.5, delay: 540  },
  ];

  // Lines: outer rectangle (4 segments) plus four short inward notch
  // segments anchored at the midpoint nodes. The notches gesture at
  // a denser network without crossing the text — earlier iterations
  // had a horizontal midline crossbar, but it ran straight through
  // the wordmark and broke readability.
  const NOTCH = 14;
  const lines = [
    { x1: x0, y1: y0, x2: x1, y2: y0, delay: 350 },  // top
    { x1: x1, y1: y0, x2: x1, y2: y1, delay: 450 },  // right
    { x1: x1, y1: y1, x2: x0, y2: y1, delay: 550 },  // bottom
    { x1: x0, y1: y1, x2: x0, y2: y0, delay: 650 },  // left
    // Notches: from each midpoint node a short tick pointing toward
    // the centre of the frame. Together they read as a partial
    // crosshair around (not over) the title.
    { x1: xm, y1: y0, x2: xm, y2: y0 + NOTCH, delay: 800 }, // top → down
    { x1: x1, y1: ym, x2: x1 - NOTCH, y2: ym, delay: 860 }, // right → left
    { x1: xm, y1: y1, x2: xm, y2: y1 - NOTCH, delay: 920 }, // bottom → up
    { x1: x0, y1: ym, x2: x0 + NOTCH, y2: ym, delay: 980 }, // left → right
  ];

  return (
    <div
      style={{
        width:    '100%',
        maxWidth: 560,
        margin:   '0 auto',
        position: 'relative',
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        aria-hidden="true"
      >
        {/* Lines: each has a long dash that starts fully offset (invisible)
            and animates to dashoffset 0 (fully drawn) using the
            'drawIn' keyframes defined in onboarding-anim.css below. */}
        {lines.map((ln, i) => {
          const len = Math.hypot(ln.x2 - ln.x1, ln.y2 - ln.y1);
          return (
            <line
              key={`l${i}`}
              x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
              stroke={INK}
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeDasharray={len}
              strokeDashoffset={len}
              style={{
                animation: `obDrawIn 600ms ease-out ${ln.delay}ms forwards`,
              }}
            />
          );
        })}

        {/* Nodes: little circles with a pop-in scale animation. */}
        {nodes.map((n, i) => (
          <circle
            key={`n${i}`}
            cx={n.x} cy={n.y} r={n.r}
            fill={INK}
            style={{
              transformBox:    'fill-box',
              transformOrigin: 'center',
              opacity:         0,
              transform:       'scale(0.2)',
              animation:       `obNodeIn 380ms cubic-bezier(.2,1.4,.4,1) ${n.delay}ms forwards`,
            }}
          />
        ))}

        {/* Title text */}
        <text
          x={xm} y={ym + 9}
          textAnchor="middle"
          fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
          fontWeight={600}
          fontSize={42}
          fill={INK}
          letterSpacing="-0.01em"
          style={{
            opacity:         0,
            transformBox:    'fill-box',
            transformOrigin: 'center',
            animation:       'obTitleIn 700ms cubic-bezier(.2,.7,.2,1) 700ms forwards',
          }}
        >
          La Pipopipette
        </text>
      </svg>
    </div>
  );
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
        <span style={{ fontStyle: 'italic' }}>“La Pipopipette”</span>,
        meaning <span style={{ fontStyle: 'italic' }}>“the game of little lines.”</span>
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
        listStyle:  'none',
        padding:    0,
        margin:     '4px 0 0',
        textAlign:  'left',
        display:    'flex',
        flexDirection: 'column',
        gap:        12,
      }}>
        {[
          'Draw one line between two dots.',
          'Take turns passing the device.',
          'Complete a cube to claim it.',
          'Completing a cube gives you another turn.',
          'Most cubes wins.',
          'The last line of a cube is powerful — make sure you’re the one taking it.',
        ].map((line, i) => (
          <li key={i} style={{
            display:    'flex',
            alignItems: 'baseline',
            gap:        12,
            lineHeight: 1.45,
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

  // Auto-advance from the title screen after a short hold so users who
  // don't click still proceed. They can also click "Continue" to skip
  // ahead at any time.
  useEffect(() => {
    if (step !== 'title') return;
    const t = window.setTimeout(() => {
      if (!closing) {
        stepKey.current += 1;
        setStep('history');
      }
    }, 4200);
    return () => window.clearTimeout(t);
  }, [step, closing]);

  return (
    <>
      {/* Inline keyframes — kept colocated so the overlay is fully
          self-contained and we don't have to add a global stylesheet
          just for these animations. */}
      <style>{`
        @keyframes obOverlayIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes obOverlayOut { from { opacity: 1; } to { opacity: 0; } }

        @keyframes obDrawIn     { to { stroke-dashoffset: 0; } }
        @keyframes obNodeIn     { to { opacity: 1; transform: scale(1); } }
        @keyframes obTitleIn    {
          0%   { opacity: 0; transform: translateY(8px) scale(0.985); }
          100% { opacity: 1; transform: translateY(0)   scale(1);     }
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
        .ob-cta:hover { background: rgba(44,26,14,0.10); }
        .ob-cta:active { transform: translateY(1px); }

        .ob-skip { transition: color 0.15s; }
        .ob-skip:hover { color: ${INK}; }
      `}</style>

      <div
        style={{
          position:       'fixed',
          inset:          0,
          background:     BG,
          zIndex:         50,                       // above canvas (which is z<10)
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          padding:        '24px 24px',
          paddingTop:     'calc(env(safe-area-inset-top, 0px) + 24px)',
          paddingBottom:  'calc(env(safe-area-inset-bottom, 0px) + 24px)',
          fontFamily:     'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color:          INK,
          animation:      closing
            ? 'obOverlayOut 460ms ease-in forwards'
            : 'obOverlayIn 360ms ease-out forwards',
        }}
      >
        {/* Skip link — small, top-right; lets returning visitors who
            re-cleared storage, or anyone who wants to jump straight to
            the cube, do so without reading. */}
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
              fontFamily: 'inherit',
              fontSize:   13,
              letterSpacing: '0.02em',
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
            <TitleNetwork />
            <div style={{
              marginTop:     20,
              fontSize:      13,
              color:         INK_DIM,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              opacity:       0,
              animation:     'obTitleIn 600ms ease-out 1300ms forwards',
            }}>
              3D Dots &amp; Boxes
            </div>
            <button
              onClick={goNext}
              className="ob-cta"
              style={{
                marginTop:    36,
                padding:      '12px 28px',
                borderRadius: 12,
                border:       `1px solid rgba(44,26,14,0.18)`,
                background:   'rgba(44,26,14,0.06)',
                color:        INK,
                fontFamily:   'inherit',
                fontSize:     15,
                fontWeight:   600,
                cursor:       'pointer',
                opacity:      0,
                animation:    'obButtonIn 500ms ease-out 1700ms forwards',
              }}
            >
              Begin
            </button>
          </div>
        ) : (
          <div
            key={stepKey.current}
            style={{
              width:        '100%',
              maxWidth:     520,
              textAlign:    'center',
              animation:    'obPanelIn 420ms cubic-bezier(.2,.7,.2,1) forwards',
            }}
          >
            <div style={{
              fontSize:      12,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color:         INK_DIM,
              marginBottom:  12,
            }}>
              {SECTIONS[step].eyebrow}
            </div>

            <div style={{
              fontSize:   step === 'how' ? 16 : 18,
              lineHeight: 1.55,
              color:      INK_MED,
              fontWeight: 400,
            }}>
              {SECTIONS[step].body}
            </div>

            <button
              onClick={goNext}
              className="ob-cta"
              style={{
                marginTop:    36,
                padding:      '12px 28px',
                borderRadius: 12,
                border:       `1px solid rgba(44,26,14,0.18)`,
                background:   'rgba(44,26,14,0.06)',
                color:        INK,
                fontFamily:   'inherit',
                fontSize:     15,
                fontWeight:   600,
                cursor:       'pointer',
                opacity:      0,
                animation:    'obButtonIn 420ms ease-out 220ms forwards',
              }}
            >
              {SECTIONS[step].cta}
            </button>

            {/* Step indicator dots */}
            <div style={{
              marginTop:  24,
              display:    'flex',
              justifyContent: 'center',
              gap:        8,
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
