import React, { useEffect, useRef, useState } from 'react';

// Chillhop Radio (24/7 lo-fi YouTube live stream).
// We embed the live stream in a hidden iframe and drive playback via
// postMessage instead of loading the full YouTube iFrame Player API
// script — postMessage commands work as long as the iframe URL has
// `enablejsapi=1`, and that's all we need for play/pause/mute.
//
// `autoplay=1` asks the browser to start the stream as soon as the
// iframe loads. Most browsers block audible autoplay until the user
// interacts with the page, so we *also* arm a one-shot listener that
// fires `playVideo` on the very first pointer/key event anywhere on
// the page (see useEffect below). Together this means the music
// kicks in either immediately (where allowed) or the instant the
// user touches anything (everywhere else).
const VIDEO_ID    = '5yx6BWlEVcY';
const STREAM_NAME = 'Chillhop Radio';
const STREAM_LINK = `https://www.youtube.com/live/${VIDEO_ID}`;
const STREAM_URL  = `https://www.youtube.com/embed/${VIDEO_ID}?enablejsapi=1&autoplay=1`;

// Match the rest of the UI's paper / ink palette (App.tsx INK / INK_DIM).
const INK       = '#2C1A0E';
const INK_DIM   = 'rgba(44,26,14,0.55)';
const PANEL_BG  = 'rgba(245,240,232,0.92)';
const BORDER    = 'rgba(44,26,14,0.16)';
const BG_HOVER  = 'rgba(44,26,14,0.11)';

export function MusicPlayer() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Music defaults to ON at game start. The actual audible playback is
  // gated by the browser's autoplay policy; the first-gesture effect
  // below makes sure the audio kicks in as soon as the user touches
  // anything if autoplay was blocked.
  const [playing, setPlaying] = useState(true);
  const [muted,   setMuted]   = useState(false);

  // Send a YouTube iframe-API command via postMessage. Tolerates the
  // iframe not being ready yet — YouTube simply ignores commands that
  // arrive before the player has loaded; the next click works.
  const sendCommand = (func: string) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      JSON.stringify({ event: 'command', func, args: [] }),
      '*',
    );
  };

  // First-gesture autoplay fallback. Runs once per mount: on the first
  // pointerdown/keydown anywhere on the page we send `playVideo` so
  // the music starts even on browsers that suppress audible autoplay.
  // Uses the capture phase so it fires before the player's own button
  // handlers — that way a user whose first action is clicking the
  // pause button still gets the desired final state (the explicit
  // pauseVideo arrives after our playVideo and wins).
  useEffect(() => {
    let armed = true;
    const onFirstGesture = () => {
      if (!armed) return;
      armed = false;
      sendCommand('playVideo');
      window.removeEventListener('pointerdown', onFirstGesture, true);
      window.removeEventListener('keydown',     onFirstGesture, true);
    };
    window.addEventListener('pointerdown', onFirstGesture, true);
    window.addEventListener('keydown',     onFirstGesture, true);
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture, true);
      window.removeEventListener('keydown',     onFirstGesture, true);
    };
  }, []);

  const togglePlay = () => {
    if (playing) sendCommand('pauseVideo');
    else         sendCommand('playVideo');
    setPlaying(p => !p);
  };

  const toggleMute = () => {
    if (muted) sendCommand('unMute');
    else       sendCommand('mute');
    setMuted(m => !m);
  };

  const iconBtn: React.CSSProperties = {
    width:           36,
    height:          36,
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    border:          `1px solid ${BORDER}`,
    borderRadius:    10,
    background:      'rgba(44,26,14,0.06)',
    color:           INK,
    cursor:          'pointer',
    transition:      'background 0.12s, border-color 0.12s',
    padding:         0,
    fontFamily:      'inherit',
    userSelect:      'none',
    WebkitUserSelect:'none',
  };

  return (
    <>
      {/* Hidden audio source. Stays in the DOM so postMessage can reach it,
          but takes up zero visual space and isn't focusable. Browsers still
          play the audio track even when the iframe has no visible area. */}
      <iframe
        ref={iframeRef}
        src={STREAM_URL}
        title={STREAM_NAME}
        allow="autoplay; encrypted-media; picture-in-picture"
        tabIndex={-1}
        aria-hidden="true"
        style={{
          position:      'absolute',
          top:           0,
          left:          0,
          width:         1,
          height:        1,
          opacity:       0,
          pointerEvents: 'none',
          border:        'none',
        }}
      />

      {/* Visible controls + attribution, anchored just below the top bar
          on the right side so they don't compete with the score indicators
          above or the Vibe Jam tab pinned at vertical center on the right
          edge. */}
      <div
        style={{
          position:       'absolute',
          top:            'calc(env(safe-area-inset-top, 0px) + 72px)',
          right:          'calc(env(safe-area-inset-right, 0px) + 12px)',
          zIndex:         10,
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'flex-end',
          gap:            6,
          pointerEvents:  'auto',
        }}
      >
        <div
          style={{
            display:              'flex',
            gap:                  6,
            padding:              6,
            background:           PANEL_BG,
            borderRadius:         12,
            border:               `1px solid ${BORDER}`,
            backdropFilter:       'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
          }}
        >
          <button
            onClick={togglePlay}
            style={iconBtn}
            title={playing ? 'Pause music' : 'Play music'}
            aria-label={playing ? 'Pause music' : 'Play music'}
            aria-pressed={playing}
            onMouseEnter={e => (e.currentTarget.style.background = BG_HOVER)}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(44,26,14,0.06)')}
          >
            {playing ? <PauseIcon/> : <PlayIcon/>}
          </button>
          <button
            onClick={toggleMute}
            style={iconBtn}
            title={muted ? 'Unmute' : 'Mute'}
            aria-label={muted ? 'Unmute' : 'Mute'}
            aria-pressed={muted}
            onMouseEnter={e => (e.currentTarget.style.background = BG_HOVER)}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(44,26,14,0.06)')}
          >
            {muted ? <MuteIcon/> : <SpeakerIcon/>}
          </button>
        </div>

        <a
          href={STREAM_LINK}
          target="_blank"
          rel="noopener noreferrer"
          title="Open Chillhop Radio on YouTube"
          style={{
            fontSize:       10,
            color:          INK_DIM,
            textDecoration: 'none',
            letterSpacing:  '0.04em',
            padding:        '3px 7px',
            background:     PANEL_BG,
            borderRadius:   6,
            border:         `1px solid ${BORDER}`,
            fontFamily:     'inherit',
          }}
        >
          ♫ {STREAM_NAME}
        </a>
      </div>
    </>
  );
}

// --- icons (16×16, currentColor so they pick up the button's color) -------

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M4.5 3.2 L13 8 L4.5 12.8 Z"/>
  </svg>
);

const PauseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <rect x="4"   y="3" width="2.8" height="10" rx="0.6"/>
    <rect x="9.2" y="3" width="2.8" height="10" rx="0.6"/>
  </svg>
);

const SpeakerIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
       stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">
    <path d="M3 6.2 L3 9.8 L5.5 9.8 L9 12.5 L9 3.5 L5.5 6.2 Z" fill="currentColor"/>
    <path d="M11.2 5.6 Q12.8 8 11.2 10.4"/>
    <path d="M12.6 4.2 Q15 8 12.6 11.8"/>
  </svg>
);

const MuteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
       stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">
    <path d="M3 6.2 L3 9.8 L5.5 9.8 L9 12.5 L9 3.5 L5.5 6.2 Z" fill="currentColor"/>
    <path d="M11.5 6 L14.5 9 M14.5 6 L11.5 9"/>
  </svg>
);
