import { useEffect, useRef } from 'react';

// Animated character sketch panels that flank the 3D cube.
//
// Player A (blue frog)  → left side
// Player B (red rabbit) → right side
//
// Each panel is anchored near the bottom button bar and horizontally
// centered in the gutter between the cube edge and the screen wall.
// mix-blend-mode: multiply + contrast/brightness filter erase the
// video's off-white paper background so only the character ink lines
// are visible against the game surface.
//
// Hidden at ≤900px via .pcp rule in index.css — below that width the
// cube fills too much horizontal space for the panels to fit safely.

interface Props {
  player:   'A' | 'B';
  isActive: boolean;
  gameOver: boolean;
}

export function PlayerCharacterPanel({ player, isActive, gameOver }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const show     = isActive && !gameOver;

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
    <div
      className="pcp"
      aria-hidden="true"
      style={{
        position:      'absolute',
        // Anchor near the bottom bar so the character's feet sit just
        // above the button row. The characters extend upward from here.
        bottom:        'calc(env(safe-area-inset-bottom, 0px) + 100px)',
        // Horizontally centered in the gutter between the cube edge
        // and the screen wall — roughly 8% in from each side.
        left:          isLeft  ? '8%' : undefined,
        right:         !isLeft ? '8%' : undefined,
        // Between crumple overlay (z=2) and the UI bars (z=10).
        zIndex:        5,
        pointerEvents: 'none',
        userSelect:    'none',
        // Blend into the paper background; filter pushes the off-white
        // video background toward pure white so multiply erases it.
        mixBlendMode:  'multiply' as React.CSSProperties['mixBlendMode'],
        filter:        'contrast(1.8) brightness(1.08)',
        // Slide in from the side + fade on turn change.
        opacity:       show ? 0.45 : 0,
        transform:     show
          ? 'translateX(0px)'
          : `translateX(${isLeft ? '-20px' : '20px'})`,
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
          // Responsive width, scaled per character:
          //   frog  (A) = base × 1.50
          //   bunny (B) = base × 1.15
          width:  isLeft ? 'clamp(120px, 16.5vw, 225px)' : 'clamp(92px, 12.65vw, 173px)',
          height: 'auto',
        }}
      >
        <source src={webm} type="video/webm" />
        <source src={mp4}  type="video/mp4" />
      </video>
    </div>
  );
}
