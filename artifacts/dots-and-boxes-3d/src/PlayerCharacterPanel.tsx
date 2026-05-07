import { useEffect, useRef } from 'react';

// Animated character sketch panels that flank the 3D cube.
//
// Player A (blue frog)  → left side
// Player B (red rabbit) → right side
//
// The panel is vertically centered alongside the cube and uses a
// responsive width (clamp via vw) so it never reaches the cube's
// edge regardless of viewport width.  mix-blend-mode: multiply
// makes the video's paper background disappear so only the character
// lines are visible, blending into the game's paper surface.
//
// Hidden at ≤900px (via index.css .pcp rule) — below that width the
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
        // Vertically centered alongside the cube center — panels truly
        // flank the cube rather than sitting near the bottom bar.
        top:           '50%',
        transform:     show
          ? 'translateY(-50%) translateX(0px)'
          : `translateY(-50%) translateX(${isLeft ? '-18px' : '18px'})`,
        // 2% from the screen edge so it never overlaps the cube.
        left:          isLeft  ? '2%' : undefined,
        right:         !isLeft ? '2%' : undefined,
        // Between crumple overlay (z=2) and the UI bars (z=10).
        zIndex:        5,
        pointerEvents: 'none',
        userSelect:    'none',
        // Blend into the paper background. The contrast+brightness filter
        // pushes the video's off-white paper background toward pure white
        // so multiply makes it fully disappear, leaving only the character
        // ink lines.
        mixBlendMode:  'multiply' as React.CSSProperties['mixBlendMode'],
        filter:        'contrast(1.8) brightness(1.08)',
        // Slide in from the side + fade when turn activates.
        opacity:       show ? 0.45 : 0,
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
          // Responsive width: 11vw keeps the panel well clear of the cube
          // at all viewport widths above the 900px hide threshold.
          // Max 150px so it never gets too large on ultra-wide displays.
          width:  'clamp(80px, 11vw, 150px)',
          height: 'auto',
        }}
      >
        <source src={webm} type="video/webm" />
        <source src={mp4}  type="video/mp4" />
      </video>
    </div>
  );
}
