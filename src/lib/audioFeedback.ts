// Subtle Web Audio API feedback chimes for gate check-in confirmation

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new AudioCtx();
    } catch {
      return null;
    }
  }
  return sharedAudioCtx;
}

/**
 * Call inside user-gesture handlers (clicks, submits) so browsers allow
 * immediate audio feedback on subsequent camera QR detections.
 */
export function primeCheckInAudio(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

/**
 * Plays a gentle, crisp two-note ascending chime (C6 -> E6) for immediate
 * gate check-in confirmation without harshness.
 */
export function playCheckInChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const scheduleNotes = () => {
    try {
      const now = ctx.currentTime + 0.01;
      const notes = [
        { freq: 1046.5, start: 0, duration: 0.16, peak: 0.09 },
        { freq: 1318.51, start: 0.085, duration: 0.28, peak: 0.11 },
      ];

      for (const note of notes) {
        const osc = ctx.createOscillator();
        const harmonic = ctx.createOscillator();
        const gain = ctx.createGain();
        const harmonicGain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(note.freq, now + note.start);

        harmonic.type = 'triangle';
        harmonic.frequency.setValueAtTime(note.freq * 2, now + note.start);

        gain.gain.setValueAtTime(0.0001, now + note.start);
        gain.gain.linearRampToValueAtTime(note.peak, now + note.start + 0.014);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);

        harmonicGain.gain.setValueAtTime(0.0001, now + note.start);
        harmonicGain.gain.linearRampToValueAtTime(note.peak * 0.18, now + note.start + 0.012);
        harmonicGain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + note.start + note.duration * 0.75
        );

        osc.connect(gain);
        harmonic.connect(harmonicGain);
        harmonicGain.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + note.start);
        harmonic.start(now + note.start);
        osc.stop(now + note.start + note.duration + 0.02);
        harmonic.stop(now + note.start + note.duration + 0.02);
      }
    } catch {
      // Ignore transient Web Audio API errors
    }
  };

  if (ctx.state === 'suspended') {
    ctx
      .resume()
      .then(scheduleNotes)
      .catch(() => {});
  } else {
    scheduleNotes();
  }
}
