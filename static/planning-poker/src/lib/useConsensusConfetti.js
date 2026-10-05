import { useEffect } from 'react';
import confetti from 'canvas-confetti';

// A small burst of confetti from the result card when a reveal ends in
// consensus. canvas-confetti does the physics - launch speed, air drag,
// gravity, and the tilt and wobble of falling paper - which is what makes it
// look natural, drawing frame by frame on a canvas for a couple of seconds.
//
// Each screen decides on its own from data it already has, so this costs no
// server calls, storage or realtime messages. Nothing runs once the burst is
// over: the canvas removes itself.

// If the screen wasn't visible at the reveal (a background tab, or a window
// hidden behind another), the burst waits until it is - but not forever: past
// this, the moment has gone and it's skipped.
const LATE_MS = 10 * 1000;

// Mostly Atlassian blue, with a few of Jira's other accent colours. They're
// read from Jira's design tokens so they suit light and dark mode; the library
// needs hex colours, so anything else falls back to the light-mode hex.
const PALETTE = [
    ['--ds-background-brand-bold', '#0c66e4'],
    ['--ds-background-brand-bold', '#0c66e4'],
    ['--ds-background-accent-blue-subtle', '#579dff'],
    ['--ds-background-accent-blue-subtle', '#579dff'],
    ['--ds-background-accent-green-subtle', '#4bce97'],
    ['--ds-background-accent-yellow-subtle', '#e2b203'],
    ['--ds-background-accent-purple-subtle', '#9f8fef'],
    ['--ds-background-accent-magenta-subtle', '#e774bb'],
];

function colours() {
    const styles = getComputedStyle(document.documentElement);
    return PALETTE.map(([token, fallback]) => {
        const value = styles.getPropertyValue(token).trim();
        return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
    });
}

// Fires one burst from the middle of `originEl` and returns a function that
// stops it early (used if the view goes away mid-burst).
function burst(originEl) {
    // Our own full-frame canvas: the library's default one runs in a web
    // worker, which a Forge app's content security policy may not allow.
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);

    const fire = confetti.create(canvas, {
        resize: true,
        useWorker: false,
        // Respects the "reduce motion" accessibility setting.
        disableForReducedMotion: true,
    });

    const rect = originEl?.getBoundingClientRect();
    const origin = rect
        ? {
              x: (rect.left + rect.width / 2) / window.innerWidth,
              y: (rect.top + rect.height / 2) / window.innerHeight,
          }
        : { x: 0.15, y: 0.7 };

    // "Very little": a few dozen small pieces, thrown up and slightly to the
    // right (where the panel has room), gently enough to stay in view.
    const done = fire({
        particleCount: 40,
        angle: 75,
        spread: 65,
        startVelocity: 24,
        decay: 0.92,
        gravity: 0.8,
        ticks: 170,
        scalar: 0.75,
        origin,
        colors: colours(),
    });

    let stopped = false;
    const stop = () => {
        if (!stopped) {
            stopped = true;
            fire.reset();
            canvas.remove();
        }
    };

    Promise.resolve(done).then(stop);
    return stop;
}

// Plays one burst when `active` becomes true, from the element in `originRef`.
export function useConsensusConfetti(active, originRef) {
    useEffect(() => {
        if (!active) {
            return undefined;
        }

        const seenAt = Date.now();
        let stop = null;

        // Returns false while the screen is hidden, so it can be retried.
        const play = () => {
            if (document.visibilityState !== 'visible') {
                return false;
            }
            if (Date.now() - seenAt <= LATE_MS) {
                stop = burst(originRef.current);
            }
            return true;
        };

        if (play()) {
            return () => stop?.();
        }

        const onVisibility = () => {
            if (play()) {
                document.removeEventListener('visibilitychange', onVisibility);
            }
        };
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            stop?.();
        };
    }, [active, originRef]);
}
