import { useEffect, useRef } from 'react';

// Animated character sketch panels that appear flanking the 3D cube.
//
// Player A (blue frog)  → left side
// Player B (red rabbit) → right side
//
// The panel slides up and fades in when it's that player's turn, using
// mix-blend-mode: multiply so the sketch reads as part of the paper
// surface rather than a floating overlay. Videos are served from
// public/videos/ (not bundled) and referenced via BASE_URL.

interface Props {
  player:  'A' | 'B';
  isActive: boolean;
  gameOver: boolean;
}

export function PlayerCharacterPanel({ player, isActive, gameOver }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const show     = isActive && !gameOver;

  // Imperatively play/pause so the video is in sync with the active state.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (show) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [show]);

  const isLeft = player === 'A';
  const base   = import.meta.env.BASE_URL as string;
  const webm   = `${base}videos/player-${isLeft ? 'blue' : 'red'}.webm`;
  const mp4    = `${base}videos/player-${isLeft ? 'blue' : 'red'}.mp4`;

  return (
    <>
      {/* Hide entirely on narrow screens so the panels never overlap the cube
          or the bottom controls. 600px is a safe cut-off that covers all
          phones in portrait orientation. */}
      <style>{`
        .pcp { display: block; }
        @media (max-width: 600px) { .pcp { display: none !important; } }
      `}</style>

      <div
        className="pcp"
        aria-hidden="true"
        style={{
          position:      'absolute',
          // Sit just above the bottom bar (~100px) so the character's feet
          // land near the bottom of the game area.
          bottom:        'calc(env(safe-area-inset-bottom, 0px) + 100px)',
          // Horizontal: hug the screen edge, leaving a 1% margin.
          left:          isLeft  ? '1%' : undefined,
          right:         !isLeft ? '1%' : undefined,
          // Between crumple overlay (2) and the UI bars (10).
          zIndex:        5,
          pointerEvents: 'none',
          userSelect:    'none',
          // Blend into the paper background exactly like the crumple overlay.
          mixBlendMode:  'multiply' as React.CSSProperties['mixBlendMode'],
          // Slide-up + fade transition when turn changes.
          opacity:       show ? 0.45 : 0,
          transform:     show ? 'translateY(0px)' : 'translateY(24px)',
          transition:    'opacity 350ms ease-out, transform 350ms ease-out',
        }}
      >
        <video
          ref={videoRef}
          loop
          muted
          playsInline
          autoPlay
          style={{
            display: 'block',
            // Responsive height: cap at 28vh so it never crowds the cube,
            // with an absolute max of 200px on tall desktop screens.
            height:  'min(28vh, 200px)',
            width:   'auto',
          }}
        >
          <source src={webm} type="video/webm" />
          <source src={mp4}  type="video/mp4" />
        </video>
      </div>
    </>
  );
}
